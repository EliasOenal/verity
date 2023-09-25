// cube.ts
import { BinaryDataError, BinaryLengthError, CUBE_HEADER_LENGTH, CubeError, CubeSignatureError, CubeType, FieldNotImplemented, FieldSizeError,  SmartCubeError, SmartCubeTypeNotImplemented, UnknownFieldType } from "./cubeDefinitions";
import { Settings } from './config';
import { NetConstants } from './networkDefinitions';
import { CubeInfo } from "./cubeInfo";
import * as CubeUtil from './cubeUtil';
import { CubeField, CubeFieldLength, CubeFieldType, CubeFields } from './cubeFields';
import { FieldParser } from "./fieldParser";
import { logger } from './logger';

import { isBrowser, isNode, isWebWorker, isJsDom, isDeno } from "browser-or-node";
import sodium, { KeyPair } from 'libsodium-wrappers'
import { Buffer } from 'buffer';

// semantic typedef
// TAKE CARE! TRAP! TYPESCRIPT IS CRAP! (that rhymes)
// Never check if something is instanceof CubeKey, it never will be.
// All the underlying lib will ever give us are Buffers, and Typescript will
// gladly allow you to treat a Buffer as CubeKey without correctly downcasting it :(
export class CubeKey extends Buffer {}

export class Cube {
    private version: number = 0;  // TODO: Remove, this is stored in the first positional field
    private reservedBits: number = 0;  // TODO: Remove, this is stored in the first positional field... and it's unused anyway
    private fields: CubeFields;
    private binaryData: Buffer | undefined = undefined;
    private hash: Buffer | undefined = undefined;

    private _privateKey: Buffer | undefined;
    get privateKey() { return this._privateKey; }

    // TODO remove: Unnecessary and error-prone duplication.
    // publicKey should fetch the data from the PUBLIC_KEY field
    private _publicKey: Buffer | undefined;
    get publicKey() { return this._publicKey; }

    get cubeType(): CubeType {
        const smartField = this.getFields().getFirstField(CubeFieldType.SMART_CUBE);
        if (!smartField) return CubeType.CUBE_TYPE_REGULAR;
        else return CubeUtil.parseSmartCube(smartField.type);
    }

    /**
     * Create a new Mutable User Cube, which is a type of smart cube usually
     * representing a user and storing data usually associated with a user
     * profile.
     * @param customfields
     *   An array of all custom fields, e.g. PAYLOAD, RELATES_TO etc.
     *   This method will supplement your fields with the required "boilerplate"
     *   fields, i.e. SMART_CUBE, PUBLIC_KEY and SIGNATUE.
     */
    // Note: Including minimum hashcash space and the payload field header,
    // this makes a boilerplate cube 120 bytes long,
    // meaning there's 904 bytes left for payload.
    static MUC(publicKey: Buffer | Uint8Array,
               privateKey: Buffer | Uint8Array,
               customfields: CubeFields | Array<CubeField> | CubeField = [],
               required_difficulty = Settings.REQUIRED_DIFFICULTY): Cube {
        if (customfields instanceof CubeField) customfields = [customfields];
        if (customfields instanceof CubeFields) customfields = customfields.all();
        if (!(publicKey instanceof Buffer)) publicKey = Buffer.from(publicKey);
        if (!(privateKey instanceof Buffer)) privateKey = Buffer.from(privateKey);
        const cube: Cube = new Cube(undefined, required_difficulty);
        cube.setCryptoKeys(publicKey as Buffer, privateKey as Buffer);
        const fields: CubeFields = new CubeFields([
            new CubeField(CubeFieldType.SMART_CUBE | 0b00, 0, Buffer.alloc(0)),
            new CubeField(
                CubeFieldType.PUBLIC_KEY,
                NetConstants.PUBLIC_KEY_SIZE,
                publicKey as Buffer)
        ].concat(customfields).concat([
            new CubeField(
                CubeFieldType.SIGNATURE,
                NetConstants.SIGNATURE_SIZE,
                Buffer.alloc(NetConstants.SIGNATURE_SIZE))
        ]));
        cube.setFields(fields);
        return cube;
    }

    /**
     * Create an Immutable Persistant Cube, which is a type of smart cube used
     * for data to be made available long-term.
     */
    static IPC(required_difficulty = Settings.REQUIRED_DIFFICULTY): Cube {
        // TODO implement
        return undefined;
    }

    constructor(
            binaryData?: Buffer,
            private readonly required_difficulty = Settings.REQUIRED_DIFFICULTY)
        {
        if (binaryData && binaryData.length !== NetConstants.CUBE_SIZE) {
            logger.error(`Cube must be ${NetConstants.CUBE_SIZE} bytes`);
            throw new BinaryLengthError(`Cube must be ${NetConstants.CUBE_SIZE} bytes`);
        }

        if (binaryData === undefined) {  // new locally created cube
            this.setFields(new CubeFields());  // TODO why are we doing this?
        } else {  // existing cube, usually received from the network
            this.binaryData = binaryData;
            this.hash = CubeUtil.calculateHash(binaryData);
            this.fields = new CubeFields(FieldParser.toplevel.decompileFields(
                this.binaryData));
            this.verifyCubeFields();
            this.parseCubeType();
        }
    }

    // This is only used (or useful) for locally created cubes.
    // It will create a CubeInfo object for our new cube once we found the
    // cube key, which involves the hashcash proof of work and therefore can
    // take a little while.
    public async getCubeInfo(): Promise<CubeInfo> {
        return new CubeInfo(
            await this.getKey(),
            await this.getBinaryData(),
            this.cubeType,
            this.getDate(),
            CubeUtil.countTrailingZeroBits(this.hash),
        );
    }

    // TODO: Do we need this?
    public getVersion(): number {
        return this.version;
    }

    // TODO can this be removed?
    // Current implementation doesn't work anyway as version is now stored in
    // the first positional field
    // public setVersion(version: number): void {
    //     this.cubeManipulated();
    //     if (version !== 0) {
    //         logger.error('Only version 0 is supported');
    //         throw new CubeError("Only version 0 is supported");
    //     }
    // }

    public setCryptoKeys(
            publicKey: Buffer,
            privateKey: Buffer,
            iSwearImOnlyResupplyingThePrivateKeyAndNotChangingAnythingElse: boolean = false): void {
        if (!iSwearImOnlyResupplyingThePrivateKeyAndNotChangingAnythingElse) this.cubeManipulated();  // TODO this is obviously ugly as hell
        this._publicKey = publicKey;
        this._privateKey = privateKey;
    }

    public getDate(): number {
        const dateField: CubeField =
            this.getFields().getFirstField(CubeFieldType.DATE);
        return dateField.value.readUIntBE(0, NetConstants.TIMESTAMP_SIZE);
    }

    public setDate(date: number): void {
        this.cubeManipulated();
        const dateField: CubeField =
            this.getFields().getFirstField(CubeFieldType.DATE);
        dateField.value = Buffer.alloc(CubeFieldLength[CubeFieldType.DATE]);
        dateField.value.writeUIntBE(date,  0, NetConstants.TIMESTAMP_SIZE);
    }

    public getFields(): CubeFields {
        return this.fields;
    }

    public setFields(fields: CubeFields | CubeField): void {
        this.cubeManipulated();
        if (fields instanceof CubeFields) this.fields = fields;
        else if (fields instanceof CubeField) this.fields = new CubeFields(fields);
        else throw TypeError("Invalid fields type");

        // verify all fields together are less than 1024 bytes,
        // and there's still enough space left for the hashcash
        let totalLength = CUBE_HEADER_LENGTH;
        for (const field of this.fields.all()) {
            totalLength += field.length;
            totalLength += FieldParser.toplevel.getFieldHeaderLength(field.type);
        }

        // has the user already defined a sufficienly large padding field or do we have to add one?
        const indexNonce = this.fields.all().findIndex((field: CubeField) => field.type == CubeFieldType.PADDING_NONCE && field.length >= Settings.HASHCASH_SIZE);
        let maxAcceptableLegth: number;
        const minHashcashFieldSize = FieldParser.toplevel.getFieldHeaderLength(CubeFieldType.PADDING_NONCE) + Settings.HASHCASH_SIZE;
        if (indexNonce == -1) maxAcceptableLegth = NetConstants.CUBE_SIZE - minHashcashFieldSize;
        else maxAcceptableLegth = NetConstants.CUBE_SIZE;

        if (totalLength > maxAcceptableLegth) {
            // <strike>TODO: offer automatic cube segmentation</strike>
            // Automatic continuation chain building will be offered on an API layer, not within the core lib
            throw new FieldSizeError('Cube: Resulting cube size is ' + totalLength + ' bytes but must be less than ' + (NetConstants.CUBE_SIZE - minHashcashFieldSize) + ' bytes (potentially due to insufficient hash cash space)');
        }

        // do we need to add extra padding?
        if (totalLength < NetConstants.CUBE_SIZE) {
            // Edge case: Minimum padding field size is two bytes.
            // If the cube is currently one byte below maximum, there is no way we can transform
            // it into a valid cube, as it's one byte too short as is but will be one byte too large
            // with minimum extra padding.
            if (totalLength > NetConstants.CUBE_SIZE - FieldParser.toplevel.getFieldHeaderLength(CubeFieldType.PADDING_NONCE)) {
                throw new FieldSizeError('Cube: Cube is too small to be valid as is but too large to add extra padding.');
            }
            // Pad with random padding nonce to reach 1024 bytes
            const num_alloc = NetConstants.CUBE_SIZE - totalLength - FieldParser.toplevel.getFieldHeaderLength(CubeFieldType.PADDING_NONCE);
            const random_bytes = new Uint8Array(num_alloc);
            for (let i = 0; i < num_alloc; i++) random_bytes[i] = Math.floor(Math.random() * 256);

            // Is there a signature field? If so, add the padding *before* the signature.
            // Otherwise, add it at the very end.
            this.fields.insertFieldBefore(CubeFieldType.SIGNATURE,
                new CubeField(
                    CubeFieldType.PADDING_NONCE,
                    num_alloc,
                    Buffer.from(random_bytes))
            );
        }
    }

    // TODO: Having something as simple as getKey() async keeps causing hickups.
    // We should make hash generation explicit and getKey() immediate.
    public async getKey(): Promise<CubeKey> {
        if (this.cubeType == CubeType.CUBE_TYPE_MUC) {
            return this.publicKey;
        } else if (this.cubeType === CubeType.CUBE_TYPE_REGULAR) {
            return await this.getHash();
        } else {
            throw new CubeError("CubeType " + this.cubeType + " not implemented");
        }
    }

    public getKeyIfAvailable(): CubeKey {
        if (this.cubeType == CubeType.CUBE_TYPE_MUC) {
            return this.publicKey;
        } else if (this.cubeType === CubeType.CUBE_TYPE_REGULAR) {
            return this.getHashIfAvailable();
        } else {
            throw new CubeError("CubeType " + this.cubeType + " not implemented");
        }
    }

    public async getHash(): Promise<Buffer> {
        if (!this.binaryData || !this.hash) await this.setBinaryData();
        return this.hash;
    }

    public getHashIfAvailable(): Buffer {
        return this.hash;
    }

    public async getBinaryData(): Promise<Buffer> {
        if (!this.binaryData || !this.hash) await this.setBinaryData();
        return this.binaryData;
    }


    /// @method Any change to a cube invalidates it and basically returns it to
    /// "new cube in the making" state. Binary data, hash and potentially cube key
    /// are now invalid. Delete them; out getter methods will make sure to
    /// recreate them when needed.
    private cubeManipulated() {
        this.binaryData = undefined;
        this.hash = undefined;
    }

    // TODO: This should be refactored to use FieldParser.compileFields().
    // Currently it opts out of certain compile steps and calls
    // FieldParser.updateTLVBinaryData() directly, which should really be private.
    // This does NOT calculate a hash, but all public methods calling it will
    // take care of that.
    private async setBinaryData(): Promise<void> {
        this.binaryData = FieldParser.toplevel.compileFields(this.fields);
        this.writeFingerprint();  // If this is a MUC, set the key fingerprint
        this.verifyCubeFields();
        if (this.binaryData.length != NetConstants.CUBE_SIZE) {
            throw new BinaryDataError("Cube: Something went horribly wrong, I just wrote a cube of invalid size " + this.binaryData.length);
        }
        await this.generateCubeHash();  // if this is a MUC, this also signs it
    }

    // Note: This method is called both on parsing and on writing binary data, which
    // is maybe elegant but also very weird.
    // TODO: Document what this method actually does.
    private verifyCubeFields(): void {
        if (this.binaryData === undefined) {
            throw new BinaryDataError("Cube: processTLVField() called on undefined binary data");
        }

        for (let i = 0; i < this.fields.getFieldCount(); i++) {
            const field = this.fields.all()[i];
            switch (field.type & 0xFC) {
            // "& 0xFC" zeroes out the last two bits as field.type is only 6 bits long
                case CubeFieldType.PADDING_NONCE:
                case CubeFieldType.PAYLOAD:
                case CubeFieldType.RELATES_TO:
                    break;
                case CubeFieldType.DATE:
                    break;
                case CubeFieldType.VERSION:
                    this.version = field.value[0] >> 4;  // TODO should be removed, unnecessary copy
                    this.reservedBits = field.value[0] & 0xF;  // TODO should be removed, unnecessary copy
                    break;
                case CubeFieldType.KEY_DISTRIBUTION:
                case CubeFieldType.SHARED_KEY:
                case CubeFieldType.ENCRYPTED:
                    logger.error('Cube: Field not implemented ' + field.type);
                    throw new FieldNotImplemented('Cube: Field not implemented ' + field.type);
                case CubeFieldType.SIGNATURE:
                    if (field.start +
                        FieldParser.toplevel.getFieldHeaderLength(CubeFieldType.SIGNATURE) +
                        field.length
                        !== NetConstants.CUBE_SIZE) {
                        logger.error('Cube: Signature field is not the last field');
                        throw new CubeSignatureError('Cube: Signature field is not the last field');
                    }
                    break;
                case CubeFieldType.SMART_CUBE:
                    // has to be very first field after positionals
                    if (i !== 2) {  // TODO: This logic should really be moved to FieldParser, but that guy currently does not support optional positional fields (i.e. fields which have a header but still must be at a certain position)
                        logger.error('Cube: Smart cube type is not the first field');
                        throw new SmartCubeError('Cube: Smart cube type is not the first field');
                    }
                    const smartCubeType = CubeUtil.parseSmartCube(field.value[0]);
                    if (smartCubeType !== CubeType.CUBE_TYPE_MUC) {
                        logger.error('Cube: Smart cube type not implemented ' + smartCubeType);
                        throw new SmartCubeTypeNotImplemented('Cube: Smart cube type not implemented ' + smartCubeType);
                    }
                    break;
                case CubeFieldType.PUBLIC_KEY:
                    // TODO: add to keystore
                    // TODO: implement keystore
                    break;
            }
        }
    }

    private parseCubeType(): void {
        const publicKey: CubeField = this.fields.getFirstField(CubeFieldType.PUBLIC_KEY);
        const signature: CubeField = this.fields.getFirstField(CubeFieldType.SIGNATURE);

        if (this.cubeType === CubeType.CUBE_TYPE_MUC) {
            if (publicKey && signature) {
                if (this.binaryData) {
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
                    const dataToVerify = this.binaryData.slice(0,
                        signature.start +
                        FieldParser.toplevel.getFieldHeaderLength(
                            CubeFieldType.SIGNATURE) +
                        NetConstants.FINGERPRINT_SIZE);

                    // Verify the signature
                    CubeUtil.verifySignature(publicKeyValue, signatureValue, dataToVerify);
                }
                this._publicKey = publicKey.value;
            } else {
                // Note: This is a bit strange as it can throw an error when the
                // key pair is actually defined (as in this.publicKey returns a valid key)
                // but the user forgot to copy it into a CubeField.
                logger.error('Cube: Public key or signature is undefined for MUC');
                throw new CubeSignatureError('Cube: Public key or signature is undefined for MUC');
            }
        }
    }

    // @member Calculates the cube hash, including the hashcash challenge
    // It makes no sense to call this method more than once on any particular
    // cube object (except maybe to heat your home).
    // Cube's getter method will make sure to call generateCubeHash() whenever
    // appropriate (i.e. when the hash is required but has not yet been calculated).
    private async generateCubeHash(): Promise<void> {
        if (this.binaryData === undefined) {
            logger.warn("Cube: generateCubeHash called on undefined binary data -- it's not a problem, but it's not supposed to happen either");
            this.setBinaryData();
        }

        const paddingField = this.fields.getFirstField(CubeFieldType.PADDING_NONCE);
        if (!paddingField) {
            logger.error('Cube: generateCubeHash() called, but no PADDING_NONCE field found');
            throw new CubeError("generateCubeHash() called, but no PADDING_NONCE field found");
        }
        const indexNonce = paddingField.start +
            FieldParser.toplevel.getFieldHeaderLength(CubeFieldType.PADDING_NONCE);

        // Calculate hashcash
        let findValidHashFunc: Function;
        // Use NodeJS worker based implementation if available and requested in config.ts
        if (Settings.HASH_WORKERS && typeof this.findValidHashWorker === 'function') {
            findValidHashFunc = this.findValidHashWorker;
        }
        else findValidHashFunc = this.findValidHash;
        this.hash = await findValidHashFunc.call(this, indexNonce);
        // logger.info("cube: Using hash " + this.hash.toString('hex') + "as cubeKey");
    }

    private writeFingerprint(): void {
        if (!this.binaryData) {
            throw new BinaryDataError("Cube: writeFingerprint() called with undefined binary data");
        }
        const signature: CubeField =
            this.fields.getFirstField(CubeFieldType.SIGNATURE);
        if (!signature) return;  // no signature field = no fingerprint
        if (!this.publicKey) {
            throw new CubeError("Cube: writeFingerprint() called without a public key");
        }
        if (!signature.start) {
            // this matches both when start is undefined and when it's zero,
            // and in this case this is a good thing :)
            throw new BinaryDataError("Cube: writeFingerprint() called with unfinalized fields");
        }
        if (signature.start !=
            NetConstants.CUBE_SIZE -
            CubeFieldLength[CubeFieldType.SIGNATURE] -
            FieldParser.toplevel.getFieldHeaderLength(CubeFieldType.SIGNATURE)) {
            throw new Error("Signature start index must be the last field at 952");
        }

        // Compute the fingerprint of the public key (first 8 bytes of its hash)
        const fingerprint = CubeUtil.calculateHash(this.publicKey).slice(0, 8);

        // Write the fingerprint to binaryData
        this.binaryData.set(fingerprint, signature.start +
            FieldParser.toplevel.getFieldHeaderLength(CubeFieldType.SIGNATURE));
    }

    private signBinaryData(): void {
        if (!this.binaryData) {
            throw new BinaryDataError("Cube: signBinaryData() called with undefined binary data");
        }
        const signature: CubeField =
            this.fields.getFirstField(CubeFieldType.SIGNATURE);
        if (!signature) return;  // no signature field = no signature
        if (!this.publicKey || !this.privateKey) {
            throw new CubeError("Cube: signBinaryData() called without a complete public/private key pair");
        }
        if (!signature.start) {
            // this matches both when start is undefined and when it's zero,
            // and in this case this is a good thing :)
            throw new BinaryDataError("Cube: writeFingerprint() called with unfinalized fields");
        }

        if (this.binaryData === undefined) {
            throw new BinaryDataError("Binary data not initialized");
        }

        // Extract the portion of binaryData to be signed:
        // start to the type byte of the signature field + fingerprint
        const dataToSign = this.binaryData.slice(0,
            signature.start +
            FieldParser.toplevel.getFieldHeaderLength(CubeFieldType.SIGNATURE) +
            NetConstants.FINGERPRINT_SIZE);  // +8 for fingerprint

        // Generate the signature
        const signatureBinary = sodium.crypto_sign_detached(
            dataToSign, this.privateKey);

        // Write the signature back to binaryData
        this.binaryData.set(signatureBinary,
            signature.start +
            FieldParser.toplevel.getFieldHeaderLength(CubeFieldType.SIGNATURE)+
            NetConstants.FINGERPRINT_SIZE);  // after fingerprint
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
    private async findValidHash(nonceStartIndex: number): Promise<Buffer> {
        // logger.trace("Cube: Running findValidHash (non-worker)");
        await sodium.ready;
        return new Promise((resolve) => {
            let nonce: number = 0;
            let hash: Buffer;
            const checkHash = () => {
                if (this.binaryData === undefined) {
                    throw new BinaryDataError("Binary data not initialized");
                }
                // Check 1000 hashes before yielding control back to the event loop
                for (let i = 0; i < 1000; i++) {
                    // Write the nonce to binaryData
                    this.binaryData.writeUIntBE(nonce, nonceStartIndex, Settings.HASHCASH_SIZE);
                    // If this is a MUC and signatureStartIndex is provided, sign the updated data
                    this.signBinaryData();
                    // Calculate the hash
                    hash = CubeUtil.calculateHash(this.binaryData);
                    // Check if the hash is valid
                    if (CubeUtil.countTrailingZeroBits(hash) >= this.required_difficulty) {
                        // logger.trace("Cube: Found valid hash with nonce " + nonce);
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

    getDifficulty(): number {
        if (this.binaryData === undefined) this.setBinaryData();
        if (this.hash === undefined) this.generateCubeHash();
        return CubeUtil.countTrailingZeroBits(this.hash);
    }

}

if (isNode) require('./nodespecific/cube-extended');
