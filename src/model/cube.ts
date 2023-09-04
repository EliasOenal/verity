// cube.ts
import { CubeInfo } from "./cubeInfo";
import * as CubeUtil from './cubeUtil';
import { Settings, VerityError } from './config';
import { NetConstants } from './networkDefinitions';
import { Field, Fields, TopLevelField, TopLevelFields } from './fields';
import { FieldParser } from "./fieldParser";
import { CUBE_HEADER_LENGTH, CubeType, FieldType } from "./cubeDefinitions";
import { logger } from './logger';

import { isBrowser, isNode, isWebWorker, isJsDom, isDeno } from "browser-or-node";
import sodium, { KeyPair } from 'libsodium-wrappers'
import { Buffer } from 'buffer';

export class CubeKey extends Buffer {}  // semantic typedef, TODO use this everywhere

export class Cube {
    private version: number;
    private reservedBits: number;
    private date: number;
    private fields: TopLevelFields;
    private binaryData: Buffer | undefined;
    private hash: Buffer | undefined;
    private _privateKey: Buffer | undefined;
    private _publicKey: Buffer | undefined;
    private cubeType: number | undefined;
    private cubeKey: CubeKey | undefined;

    /**
     * Create a new Mutable User Cube, which is a type of smart cube usually
     * representing a user and storing data usually associated with a user
     * profile.
     * @param customfields
     *   An array of all custom fields, e.g. PAYLOAD, RELATES_TO etc.
     *   This method will supplement your fields with the required "boilerplate"
     *   fields, i.e. SMART_CUBE, PUBLIC_KEY and SIGNATUE.
     */
    static MUC(publicKey: Buffer, privateKey: Buffer,
               customfields: Array<Field> | Field = []): Cube {
        if (customfields instanceof Field) customfields = [customfields];
        const cube: Cube = new Cube();
        cube.setCryptoKeys(publicKey, privateKey);
        const fields: TopLevelFields = new TopLevelFields([
            new Field(FieldType.TYPE_SMART_CUBE | 0b00, 0, Buffer.alloc(0)),
            new Field(
                FieldType.TYPE_PUBLIC_KEY,
                NetConstants.PUBLIC_KEY_SIZE,
                publicKey)
        ].concat(customfields).concat([
            new Field(
                FieldType.TYPE_SIGNATURE,
                NetConstants.SIGNATURE_SIZE,
                Buffer.alloc(NetConstants.SIGNATURE_SIZE))
        ]));
        cube.setFields(fields);
        return cube;
    }

    /**
     * Create an Immutable Persistant Cube, which is a type of smart cube used
     * for data which should be made available long-term.
     */
    static IPC(): Cube {
        // TODO implement
        return undefined;
    }

    constructor(binaryData?: Buffer) {
        if (binaryData && binaryData.length !== NetConstants.CUBE_SIZE) {
            logger.error(`Cube must be ${NetConstants.CUBE_SIZE} bytes`);
            throw new BinaryLengthError(`Cube must be ${NetConstants.CUBE_SIZE} bytes`);
        }

        if (binaryData === undefined) {
            this.version = 0;
            this.reservedBits = 0;
            this.date = Math.floor(Date.now() / 1000);
            const num_alloc = NetConstants.CUBE_SIZE - CUBE_HEADER_LENGTH - FieldParser.toplevel.getFieldHeaderLength(FieldType.PADDING_NONCE);
            this.fields = new TopLevelFields(new TopLevelField(
                FieldType.PADDING_NONCE, num_alloc, Buffer.alloc(num_alloc)));
            this.binaryData = undefined;
            this.hash = undefined;
            this.cubeKey = undefined;
        } else {
            this.binaryData = binaryData;
            this.hash = CubeUtil.calculateHash(binaryData);
            const verified = this.verifyCubeDifficulty();
            if (!verified) {
                logger.error('Cube does not meet difficulty requirements');
                throw new InsufficientDifficulty("Cube does not meet difficulty requirements");
            }
            this.version = binaryData[0] >> 4;
            this.reservedBits = binaryData[0] & 0xF;
            this.date = binaryData.readUIntBE(1, 5);
            this.fields = new TopLevelFields(FieldParser.toplevel.parseTLVBinaryData(this.binaryData));
            this.cubeType = CubeType.CUBE_TYPE_REGULAR;
            this.processTLVFields(this.fields, this.binaryData);
        }
    }

    // This is only used (or useful) for locally created cubes.
    // It will create a CubeInfo object for our new cube once we found the
    // cube key, which involves the hashcash proof of work and therefore can
    // take a little while.
    public async getCubeInfo(): Promise<CubeInfo> {
        return new CubeInfo(
            await this.getKey(),
            this.getBinaryData(),
            this.cubeType,
            this.date,
            CubeUtil.countTrailingZeroBits(this.hash),
        );
    }

    // In contrast to getCubeInfo, populateCubeInfo is useful for
    // remote-generated cubes.
    // For those, the CubeStore will generate a CubeInfo object once it learns
    // of the cube. Once the full cube has been received, this method will be
    // called.
    public populateCubeInfo(cubeInfo: CubeInfo) {
        cubeInfo.binaryCube = this.getBinaryData();
        cubeInfo.cubeType = this.cubeType,
        cubeInfo.date = this.date;
        cubeInfo.challengeLevel = CubeUtil.countTrailingZeroBits(this.hash);
    }

    public getVersion(): number {
        return this.version;
    }

    public setVersion(version: number): void {
        this.cubeManipulated();
        if (version !== 0) {
            logger.error('Only version 0 is supported');
            throw new CubeError("Only version 0 is supported");
        }
    }

    get privateKey() { return this._privateKey; }
    get publicKey() { return this._publicKey; }

    public setCryptoKeys(publicKey: Buffer, privateKey: Buffer): void {
        this.cubeManipulated();
        this._publicKey = publicKey;
        this._privateKey = privateKey;
    }

    public getDate(): number {
        return this.date;
    }

    public setDate(date: number): void {
        this.cubeManipulated();
        this.date = date;
    }

    public getFields(): TopLevelFields {
        return this.fields;
    }

    public setFields(fields: TopLevelFields | TopLevelField): void {
        this.cubeManipulated();
        if (fields instanceof Fields) this.fields = fields;
        else if (fields instanceof Field) this.fields = new TopLevelFields(fields);
        else throw TypeError("Invalid fields type");

        // verify all fields together are less than 1024 bytes,
        // and there's still enough space left for the hashcash
        let totalLength = CUBE_HEADER_LENGTH;
        for (const field of this.fields.data) {
            totalLength += field.length;
            totalLength += FieldParser.toplevel.getFieldHeaderLength(field.type);
        }

        // has the user already defined a sufficienly large padding field or do we have to add one?
        const indexNonce = this.fields.data.findIndex((field: Field) => field.type == FieldType.PADDING_NONCE && field.length >= Settings.HASHCASH_SIZE);
        let maxAcceptableLegth: number;
        const minHashcashFieldSize = FieldParser.toplevel.getFieldHeaderLength(FieldType.PADDING_NONCE) + Settings.HASHCASH_SIZE;
        if (indexNonce == -1) maxAcceptableLegth = NetConstants.CUBE_SIZE - minHashcashFieldSize;
        else maxAcceptableLegth = NetConstants.CUBE_SIZE;

        if (totalLength > maxAcceptableLegth) {
            // TODO: offer automatic cube segmentation
            throw new FieldSizeError('Cube: Resulting cube size is ' + totalLength + ' bytes but must be less than ' + (NetConstants.CUBE_SIZE - minHashcashFieldSize) + ' bytes (potentially due to insufficient hash cash space)');
        }

        // do we need to add extra padding?
        if (totalLength < NetConstants.CUBE_SIZE) {
            // Edge case: Minimum padding field size is two bytes.
            // If the cube is currently one byte below maximum, there is no way we can transform
            // it into a valid cube, as it's one byte too short as is but will be one byte too large
            // with minimum extra padding.
            if (totalLength > NetConstants.CUBE_SIZE - FieldParser.toplevel.getFieldHeaderLength(FieldType.PADDING_NONCE)) {
                throw new FieldSizeError('Cube: Cube is too small to be valid as is but too large to add extra padding.');
            }
            // Pad with random padding nonce to reach 1024 bytes
            const num_alloc = NetConstants.CUBE_SIZE - totalLength - FieldParser.toplevel.getFieldHeaderLength(FieldType.PADDING_NONCE);
            const random_bytes = new Uint8Array(num_alloc);
            for (let i = 0; i < num_alloc; i++) random_bytes[i] = Math.floor(Math.random() * 256);

            // Is there a signature field? If so, add the padding *before* the signature.
            // Otherwise, add it at the very end.
            this.fields
            this.fields.insertFieldBefore(FieldType.TYPE_SIGNATURE,
                new Field(
                    FieldType.PADDING_NONCE,
                    num_alloc,
                    Buffer.from(random_bytes))
            );
        }
    }

    public async getKey(): Promise<CubeKey> {
        if (this.cubeKey && this.hash) return this.cubeKey;
        else {
            await this.generateCubeHash();
            return this.cubeKey;
        }
    }

    public async getHash(): Promise<Buffer> {
        if (this.hash) return this.hash;
        else {
            await this.generateCubeHash();
            return this.hash;
        }
    }

    public getBinaryData(): Buffer {
        if (this.binaryData === undefined) return this.setBinaryData();
        if (!this.hash) this.generateCubeHash();
        return this.binaryData;
    }


    /// @method Any change to a cube invalidates it and basically returns it to
    /// "new cube in the making" state. Binary data, hash and potentially cube key
    /// are now invalid. Delete them; out getter methods will make sure to
    /// recreate them when needed.
    private cubeManipulated() {
        this.binaryData = undefined;
        this.hash = undefined;
        this.cubeKey = undefined;
    }

    private setBinaryData(): Buffer {
        this.processTLVFields(this.fields, this.binaryData);
        this.binaryData = Buffer.alloc(1024);

        CubeUtil.updateVersionBinaryData(this.binaryData, this.version, this.reservedBits);
        CubeUtil.updateDateBinaryData(this.binaryData, this.date);
        FieldParser.toplevel.updateTLVBinaryData(this.binaryData, this.fields.data);
        return this.binaryData;
    }

    // If binaryData is undefined, then this is a new local cube in the process of being created.
    // If binaryData is defined, then we expect a fully formed cube meeting all requirements.
    private processTLVFields(fields: Fields, binaryData: Buffer | undefined): void {
        let smart: Field = undefined;
        let publicKey: Field = undefined;
        let signature: Field = undefined;

        if (binaryData === undefined) {
            // Upgrade fields to full fields
            let start = CUBE_HEADER_LENGTH;
            for (const field of fields.data) {
                field.start = start;
                start += FieldParser.toplevel.getFieldHeaderLength(field.type & 0xFC) + field.length;
            }
        }

        for (const field of this.fields.data) {
            switch (field.type & 0xFC) {
            // "& 0xFC" zeroes out the last two bits as field.type is only 6 bits long
                case FieldType.PADDING_NONCE:
                case FieldType.PAYLOAD:
                case FieldType.RELATES_TO:
                    break;
                case FieldType.KEY_DISTRIBUTION:
                case FieldType.SHARED_KEY:
                case FieldType.ENCRYPTED:
                    logger.error('Cube: Field not implemented ' + field.type);
                    throw new FieldNotImplemented('Cube: Field not implemented ' + field.type);
                case FieldType.TYPE_SIGNATURE:
                    if (field.start +
                        FieldParser.toplevel.getFieldHeaderLength(FieldType.TYPE_SIGNATURE) +
                        field.length
                        !== NetConstants.CUBE_SIZE) {
                        logger.error('Cube: Signature field is not the last field');
                        throw new CubeSignatureError('Cube: Signature field is not the last field');
                    } else {
                        signature = field;
                    }
                    break;
                case FieldType.TYPE_SMART_CUBE:
                    if (smart !== undefined) {
                        logger.error('Cube: Multiple smart cube fields');
                    }
                    smart = field;
                    // has to be very first field
                    if (field.start !== CUBE_HEADER_LENGTH) {
                        logger.error('Cube: Smart cube type is not the first field');
                        throw new SmartCubeError('Cube: Smart cube type is not the first field');
                    }
                    const smartCubeType = CubeUtil.parseSmartCube(field.value[0]);
                    if (smartCubeType !== CubeType.CUBE_TYPE_MUC) {
                        logger.error('Cube: Smart cube type not implemented ' + smartCubeType);
                        throw new SmartCubeTypeNotImplemented('Cube: Smart cube type not implemented ' + smartCubeType);
                    }
                    break;
                case FieldType.TYPE_PUBLIC_KEY:
                    // TODO: add to keystore
                    // TODO: implement keystore
                    publicKey = field;
                    break;
                default:
                    logger.error('Cube: Unknown field type ' + field.type);
                    throw new UnknownFieldType('Cube: Unknown field type ' + field.type);
            }
        }

        if (smart && (CubeUtil.parseSmartCube(smart.type) === CubeType.CUBE_TYPE_MUC)) {
            if (publicKey && signature) {
                if (binaryData) {
                    // Extract the public key, signature values and provided fingerprint
                    const publicKeyValue = publicKey.value;
                    const providedFingerprint = signature.value.slice(0, 8); // First 8 bytes of signature field
                    const signatureValue = signature.value.slice(8); // Remaining bytes are the actual signature

                    // Verify the fingerprint
                    CubeUtil.verifyFingerprint(publicKeyValue, providedFingerprint);

                    // Create the data to be verified.
                    // It includes all bytes of the cube from the start up to and including
                    // the type byte of the signature field and the fingerprint.
                    // From start of cube up to the signature itself
                    const dataToVerify = binaryData.slice(0, signature.start
                        + FieldParser.toplevel.getFieldHeaderLength(FieldType.TYPE_SIGNATURE) + NetConstants.FINGERPRINT_SIZE);

                    // Verify the signature
                    CubeUtil.verifySignature(publicKeyValue, signatureValue, dataToVerify);
                }
                this.cubeType = CubeType.CUBE_TYPE_MUC;
                this._publicKey = publicKey.value;
                this.cubeKey = publicKey.value; // MUC, key is public key
            } else {
                logger.error('Cube: Public key or signature is undefined for MUC');
                throw new CubeSignatureError('Cube: Public key or signature is undefined for MUC');
            }
        } else { // Not a smart cube, key is hash
            this.cubeKey = this.hash;
        }
    }

    // @member Calculates the cube hash, including the hashcash challenge
    // It makes no sense to call this method more than once on any particular
    // cube object (except maybe to heat your home).
    // Cube's getter method will make sure to call generateCubeHash() whenever
    // appropriate (i.e. when the hash is required but has not yet been calculated).
    private async generateCubeHash(): Promise<Buffer> {
        // This is a new cube in the making
        if (this.binaryData === undefined) {
            this.binaryData = this.getBinaryData();
        }

        // Fields of new blocks aren't FullFields and don't know their start offset
        // so we instead use the binary data to find it
        const indexNonce = FieldParser.toplevel.findFieldIndex(this.binaryData, FieldType.PADDING_NONCE, Settings.HASHCASH_SIZE);
        if (indexNonce === undefined) {
            logger.error('No suitable PADDING_NONCE field found');
            throw new Error("No suitable PADDING_NONCE field found");
        }

        const indexSignature = FieldParser.toplevel.findFieldIndex(this.binaryData, FieldType.TYPE_SIGNATURE, 72);
        let publicKeyField;
        let mucField;
        if (indexSignature !== undefined) {
            // find the public key field
            publicKeyField = this.fields.data.find((field) => {
                return field.type === FieldType.TYPE_PUBLIC_KEY;
            });
        }
        if (publicKeyField !== undefined) {
            // find muc field
            mucField = this.fields.data.find((field) => {
                return field.type === (FieldType.TYPE_SMART_CUBE | CubeType.CUBE_TYPE_MUC);
            });
        }

        // Calculate hashcash
        let findValidHashFunc: Function;
        // Use NodeJS worker based implementation if available and requested in config.ts
        if (Settings.HASH_WORKERS && typeof this['findValidHashWorker'] === 'function') {
            findValidHashFunc = this['findValidHashWorker'];
        }
        else findValidHashFunc = this['findValidHash'];
        this.hash = await findValidHashFunc.call(this, indexNonce, indexSignature);

        logger.info("cube: Using hash " + this.hash.toString('hex') + "as cubeKey");
        this.cubeKey = this.hash;
        if (mucField !== undefined && this._publicKey !== undefined) {
            // MUCs use the public key as the cube key
            this.cubeKey = this._publicKey;
        }
        return this.cubeKey;
    }

    private writeFingerprint(publicKey: Buffer, signatureStartIndex: number): void {
        if (this.binaryData === undefined) {
            throw new BinaryDataError("Binary data not initialized");
        }
        if (signatureStartIndex != 952) {
            throw new Error("Signature start index must be the last field at 952");
        }

        // Compute the fingerprint of the public key (first 8 bytes of its hash)
        const fingerprint = CubeUtil.calculateHash(publicKey).slice(0, 8);

        // Write the fingerprint to binaryData
        this.binaryData.set(fingerprint, signatureStartIndex);
    }

    private signBinaryData(privateKey: Buffer, signatureStartIndex: number): void {
        if (this.binaryData === undefined) {
            throw new BinaryDataError("Binary data not initialized");
        }

        // Extract the portion of binaryData to be signed: start to the type byte of the signature field + fingerprint
        const dataToSign = this.binaryData.slice(0, signatureStartIndex + NetConstants.FINGERPRINT_SIZE);  // +8 for fingerprint

        // Generate the signature
        const signature = sodium.crypto_sign_detached(dataToSign, privateKey);

        // Write the signature back to binaryData
        this.binaryData.set(signature, signatureStartIndex + NetConstants.FINGERPRINT_SIZE);  // after fingerprint
    }

    /**
     * This method is only used for newly created, locally originating cubes.
     * It will be called automatically when you try to get the Cube's hash, key
     * or binary data.
     * It finds, sets and returns a valid cube hash fulfilling the current local
     * hashcash difficulty.
     * For MUCs, it also signs the cube, populating its SIGNATURE field.
     */
    // Non-worker version kept for browser portability
    private async findValidHash(nonceStartIndex: number, signatureStartIndex: number | undefined = undefined): Promise<Buffer> {
        logger.trace("Running findValidHash (non-worker)");
        await sodium.ready;
        return new Promise((resolve) => {
            let nonce: number = 0;
            let hash: Buffer;
            // If this is a MUC and signatureStartIndex is provided, set fingerprint once before the loop starts
            if (signatureStartIndex !== undefined) {
                if (this._publicKey === undefined || this._privateKey === undefined) {
                    throw new Error("Public/private key not initialized");
                }
                this.writeFingerprint(this._publicKey, signatureStartIndex);
            }
            const checkHash = () => {
                if (this.binaryData === undefined) {
                    throw new BinaryDataError("Binary data not initialized");
                }
                // Check 1000 hashes before yielding control back to the event loop
                for (let i = 0; i < 1000; i++) {
                    // Write the nonce to binaryData
                    this.binaryData.writeUInt32BE(nonce, nonceStartIndex);
                    // If this is a MUC and signatureStartIndex is provided, sign the updated data
                    if (signatureStartIndex !== undefined) {
                        this.signBinaryData(this._privateKey!, signatureStartIndex);
                    }
                    // Calculate the hash
                    hash = CubeUtil.calculateHash(this.binaryData);
                    // Check if the hash is valid
                    if (CubeUtil.countTrailingZeroBits(hash) >= Settings.REQUIRED_DIFFICULTY) {
                        logger.debug("Found valid hash with nonce " + nonce);
                        resolve(hash);
                        return;  // This is important! It stops the for loop and the function if a valid hash is found
                    }
                    // Increment the nonce
                    nonce++;
                }
                // If no valid hash was found after 1000 tries, schedule the next check
                setTimeout(checkHash, 0);
            };
            // Start the hash checking
            checkHash();
        });
    }

    private verifyCubeDifficulty(): boolean {
        if (this.binaryData === undefined)
            throw new BinaryDataError("Binary data not initialized");
        // Only calculate the hash if it has not been calculated yet
        if (this.hash === undefined)
            this.hash = CubeUtil.calculateHash(this.binaryData);

        // Check the trailing zeroes
        return CubeUtil.countTrailingZeroBits(this.hash) >= Settings.REQUIRED_DIFFICULTY;
    }

}

if (isNode) require('./nodespecific/cube-extended');


// Error definitions
export class CubeError extends VerityError { }
export class CubeApiUsageError extends CubeError { }
export class InsufficientDifficulty extends CubeError { }
export class InvalidCubeKey extends CubeError { }

export class FieldError extends CubeError { }
export class FieldSizeError extends CubeError { }
export class UnknownFieldType extends FieldError { }
export class FieldNotImplemented extends FieldError { }
export class CubeRelationshipError extends FieldError { }
export class WrongFieldType extends FieldError { }

export class BinaryDataError extends CubeError { }
export class BinaryLengthError extends BinaryDataError { }

export class SmartCubeError extends CubeError { }
export class FingerprintError extends SmartCubeError { }
export class CubeSignatureError extends SmartCubeError { }

export class SmartCubeTypeNotImplemented extends SmartCubeError { }