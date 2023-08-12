// cube.ts
import { isBrowser, isNode, isWebWorker, isJsDom, isDeno } from "browser-or-node";
import { Buffer } from 'buffer';
import sodium from 'libsodium-wrappers'
import { Settings, VerityError } from './config';
import { logger } from './logger';
import { NetConstants } from './networkDefinitions';
import * as fp from './fieldProcessing';
import { Fields } from './fieldProcessing';
import * as CubeUtil from './cubeUtil';

export const CUBE_HEADER_LENGTH: number = 6;

export class CubeInfo {
    hash: Buffer;
    cubeData: Buffer;
    smartCube: boolean;
    date: number;
    challengeLevel: number;
}

export class Cube {
    private version: number;
    private reservedBits: number;
    private date: number;
    private fields: Array<fp.Field | fp.FullField>;
    private binaryData: Buffer | undefined;
    private hash: Buffer | undefined;
    private privateKey: Buffer | undefined;
    private publicKey: Buffer | undefined;
    private smartCube: number | undefined;
    private cubeKey: Buffer | undefined;

    constructor(binaryData?: Buffer) {
        if (binaryData && binaryData.length !== NetConstants.CUBE_SIZE) {
            logger.error(`Cube must be ${NetConstants.CUBE_SIZE} bytes`);
            throw new BinaryLengthError(`Cube must be ${NetConstants.CUBE_SIZE} bytes`);
        }

        if (binaryData === undefined) {
            this.version = 0;
            this.reservedBits = 0;
            this.date = Math.floor(Date.now() / 1000);
            const num_alloc = NetConstants.CUBE_SIZE - CUBE_HEADER_LENGTH - fp.getFieldHeaderLength(fp.FieldType.PADDING_NONCE);
            this.fields = [{
                type: fp.FieldType.PADDING_NONCE,
                length: num_alloc, value: Buffer.alloc(num_alloc)
            }];
            this.binaryData = undefined;
            this.hash = undefined;
            this.cubeKey = undefined;
        } else {
            this.binaryData = binaryData;
            this.hash = CubeUtil.calculateHash(binaryData);
            let verified = this.verifyCubeDifficulty();
            if (!verified) {
                logger.error('Cube does not meet difficulty requirements');
                throw new InsufficientDifficulty("Cube does not meet difficulty requirements");
            }
            this.version = binaryData[0] >> 4;
            this.reservedBits = binaryData[0] & 0xF;
            this.date = binaryData.readUIntBE(1, 5);
            this.fields = fp.parseTLVBinaryData(this.binaryData);
            this.processTLVFields(this.fields, this.binaryData);
        }
    }

    // Verify fingerprint. This applies to smart cubes only.
    private static verifyFingerprint(publicKeyValue: Buffer, providedFingerprint: Buffer): void {
        let calculatedFingerprint = CubeUtil.calculateHash(publicKeyValue).slice(0, 8);  // First 8 bytes of signature field

        if (!calculatedFingerprint.equals(providedFingerprint)) {
            logger.error('Cube: Fingerprint does not match');
            throw new FingerprintError('Cube: Fingerprint does not match');
        }
    }

    // Verify signature. This applies to smart cubes only.
    private static verifySignature(publicKeyValue: Buffer, signatureValue: Buffer, dataToVerify: Buffer): void {
        const data = new Uint8Array(dataToVerify);
        const signature = new Uint8Array(signatureValue);
        const publicKey = new Uint8Array(publicKeyValue);

        let isSignatureValid = sodium.crypto_sign_verify_detached(signature, data, publicKey);

        if (!isSignatureValid) {
            logger.error('Cube: Invalid signature');
            throw new CubeSignatureError('Cube: Invalid signature');
        }
    }

    private static parseSmartCube(type: number): number {
        switch (type & 0x03) {
            case fp.SmartCubeType.CUBE_TYPE_MUC:
                return fp.SmartCubeType.CUBE_TYPE_MUC;
            default:
                logger.error('Cube: Smart cube type not implemented ' + type);
                throw new SmartCubeTypeNotImplemented('Cube: Smart cube type not implemented ' + type);
        }
    }


    // If binaryData is undefined, then this is a new local cube in the process of being created.
    // If binaryData is defined, then we expect a fully formed cube meeting all requirements.
    private processTLVFields(fields: Array<fp.Field | fp.FullField>, binaryData: Buffer | undefined): void {
        let smart: fp.FullField | fp.Field | undefined = undefined;
        let publicKey: fp.FullField | undefined = undefined;
        let signature: fp.FullField | undefined = undefined;

        let fullFields: Array<fp.FullField> = [];
        if (binaryData === undefined) {
            // Upgrade fields to full fields
            let start = CUBE_HEADER_LENGTH;
            for (const field of fields) {
                fullFields.push({ ...field, start: start });
                start += fp.getFieldHeaderLength(field.type & 0xFC) + field.length;
            }
        } else {
            // They're all full fields when parsed from binary data
            fullFields = fields as Array<fp.FullField>;
        }

        this.fields = fullFields;
        for (const field of fullFields) {
            switch (field.type & 0xFC) {
            // "& 0xFC" zeroes out the last two bits as field.type is only 6 bits long
                case fp.FieldType.PADDING_NONCE:
                case fp.FieldType.PAYLOAD:
                case fp.FieldType.RELATES_TO:
                    break;
                case fp.FieldType.KEY_DISTRIBUTION:
                case fp.FieldType.SHARED_KEY:
                case fp.FieldType.ENCRYPTED:
                    logger.error('Cube: Field not implemented ' + field.type);
                    throw new FieldNotImplemented('Cube: Field not implemented ' + field.type);
                case fp.FieldType.TYPE_SIGNATURE:
                    if (field.start +
                        fp.getFieldHeaderLength(fp.FieldType.TYPE_SIGNATURE) +
                        field.length
                        !== NetConstants.CUBE_SIZE) {
                        logger.error('Cube: Signature field is not the last field');
                        throw new CubeSignatureError('Cube: Signature field is not the last field');
                    } else {
                        signature = field;
                    }
                    break;
                case fp.FieldType.TYPE_SMART_CUBE:
                    if (smart !== undefined) {
                        logger.error('Cube: Multiple smart cube fields');
                    }
                    smart = field;
                    // has to be very first field
                    if (field.start !== CUBE_HEADER_LENGTH) {
                        logger.error('Cube: Smart cube type is not the first field');
                        throw new SmartCubeError('Cube: Smart cube type is not the first field');
                    }
                    const smartCubeType = Cube.parseSmartCube(field.value[0]);
                    if (smartCubeType !== fp.SmartCubeType.CUBE_TYPE_MUC) {
                        logger.error('Cube: Smart cube type not implemented ' + smartCubeType);
                        throw new SmartCubeTypeNotImplemented('Cube: Smart cube type not implemented ' + smartCubeType);
                    }
                    break;
                case fp.FieldType.TYPE_PUBLIC_KEY:
                    // TODO: add to keystore
                    // TODO: implement keystore
                    publicKey = field;
                    break;
                default:
                    logger.error('Cube: Unknown field type ' + field.type);
                    throw new UnknownFieldType('Cube: Unknown field type ' + field.type);
            }
        }

        if (smart && (Cube.parseSmartCube(smart.type) === fp.SmartCubeType.CUBE_TYPE_MUC)) {
            if (publicKey && signature) {
                if (binaryData) {
                    // Extract the public key, signature values and provided fingerprint
                    let publicKeyValue = publicKey.value;
                    let providedFingerprint = signature.value.slice(0, 8); // First 8 bytes of signature field
                    let signatureValue = signature.value.slice(8); // Remaining bytes are the actual signature

                    // Verify the fingerprint
                    Cube.verifyFingerprint(publicKeyValue, providedFingerprint);

                    // Create the data to be verified. 
                    // It includes all bytes of the cube from the start up to and including
                    // the type byte of the signature field and the fingerprint.
                    // From start of cube up to the signature itself
                    let dataToVerify = binaryData.slice(0, signature.start
                        + fp.getFieldHeaderLength(fp.FieldType.TYPE_SIGNATURE) + NetConstants.FINGERPRINT_SIZE);

                    // Verify the signature
                    Cube.verifySignature(publicKeyValue, signatureValue, dataToVerify);
                }
                this.smartCube = fp.SmartCubeType.CUBE_TYPE_MUC;
                this.publicKey = publicKey.value;
                this.cubeKey = publicKey.value; // MUC, key is public key
            } else {
                logger.error('Cube: Public key or signature is undefined for MUC');
                throw new CubeSignatureError('Cube: Public key or signature is undefined for MUC');
            }
        } else { // Not a smart cube, key is hash
            this.cubeKey = this.hash;
        }
    }

    public getCubeInfo(): CubeInfo {
        return {
            hash: this.hash,
            cubeData: this.getBinaryData(),
            smartCube: this.smartCube !== undefined,
            date: this.date,
            challengeLevel: CubeUtil.countTrailingZeroBits(this.hash),
        };
    }

    public getVersion(): number {
        return this.version;
    }

    public setVersion(version: number): void {
        if (version !== 0) {
            logger.error('Only version 0 is supported');
            throw new CubeError("Only version 0 is supported");
        }
        this.binaryData = undefined;
        this.hash = undefined;
        this.version = version;
    }

    public setKeys(publicKey: Buffer, privateKey: Buffer): void {
        this.publicKey = publicKey;
        this.privateKey = privateKey;
    }

    public getDate(): number {
        return this.date;
    }

    public setDate(date: number): void {
        const binaryData = undefined;
        this.hash = undefined;
        this.date = date;
    }

    public getFields(): Fields {
        return new Fields(this.fields)
    }

    public getFieldsArray(): Array<fp.Field> {
        return this.fields;
    }

    public setFields(fields: Fields): void;
    public setFields(fields: Array<fp.Field>): void;
    public setFields(fields: Array<fp.Field> | Fields): void {
        this.binaryData = undefined;
        this.hash = undefined;
        if (fields instanceof Fields) this.fields = fields.data;
        else if(fields instanceof Array) this.fields = fields;
        else throw new Error("Invalid fields type");

        // verify all fields together are less than 1024 bytes, and there's still enough space left for the hashcash
        let totalLength = CUBE_HEADER_LENGTH;
        for (let field of this.fields) {
            totalLength += field.length;
            totalLength += fp.getFieldHeaderLength(field.type);
        }

        // has the user already defined a sufficienly large padding field or do we have to add one?
        const indexNonce = this.fields.findIndex((field: fp.Field) => field.type == fp.FieldType.PADDING_NONCE && field.length >= Settings.HASHCASH_SIZE);
        let maxAcceptableLegth: number;
        const minHashcashFieldSize = fp.getFieldHeaderLength(fp.FieldType.PADDING_NONCE) + Settings.HASHCASH_SIZE;
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
            if (totalLength > NetConstants.CUBE_SIZE - fp.getFieldHeaderLength(fp.FieldType.PADDING_NONCE)) {
                throw new FieldSizeError('Cube: Cube is too small to be valid as is but too large to add extra padding.');
            }
            // Pad with random padding nonce to reach 1024 bytes
            const num_alloc = NetConstants.CUBE_SIZE - totalLength - fp.getFieldHeaderLength(fp.FieldType.PADDING_NONCE);
            let random_bytes = new Uint8Array(num_alloc);
            for (let i = 0; i < num_alloc; i++) random_bytes[i] = Math.floor(Math.random() * 256);
            this.fields.push({
                type: fp.FieldType.PADDING_NONCE,
                length: num_alloc, value: Buffer.from(random_bytes),
            });
        }
    }

    public async getKey(): Promise<Buffer> {
        if (this.cubeKey !== undefined)
            return this.cubeKey;
        // This is a new cube in the making
        if (this.binaryData === undefined) {
            this.binaryData = this.getBinaryData();
        }

        // Fields of new blocks aren't FullFields and don't know their start offset
        // so we instead use the binary data to find it
        const indexNonce = Cube.findFieldIndex(this.binaryData, fp.FieldType.PADDING_NONCE, Settings.HASHCASH_SIZE);
        if (indexNonce === undefined) {
            logger.error('No suitable PADDING_NONCE field found');
            throw new Error("No suitable PADDING_NONCE field found");
        }

        const indexSignature = Cube.findFieldIndex(this.binaryData, fp.FieldType.TYPE_SIGNATURE, 72);
        let publicKeyField;
        let mucField;
        if (indexSignature !== undefined) {
            // find the public key field
            publicKeyField = this.fields.find((field) => {
                return field.type === fp.FieldType.TYPE_PUBLIC_KEY;
            });
        }
        if (publicKeyField !== undefined) {
            // find muc field
            mucField = this.fields.find((field) => {
                return field.type === (fp.FieldType.TYPE_SMART_CUBE | fp.SmartCubeType.CUBE_TYPE_MUC);
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

        logger.info("Using hash " + this.hash.toString('hex') + "as cubeKey");
        this.cubeKey = this.hash;
        if (mucField !== undefined && this.publicKey !== undefined) {
            // MUCs use the public key as the cube key
            this.cubeKey = this.publicKey;
        }
        return this.cubeKey;
    }

    public getBinaryData(): Buffer {
        if (this.binaryData === undefined) {
            this.processTLVFields(this.fields, this.binaryData);
            this.binaryData = Buffer.alloc(1024);

            Cube.updateVersionBinaryData(this.binaryData, this.version, this.reservedBits);
            Cube.updateDateBinaryData(this.binaryData, this.date);
            fp.updateTLVBinaryData(this.binaryData, this.fields);
        }
        return this.binaryData;
    }

    private static updateVersionBinaryData(binaryData: Buffer, version: number, reservedBits: number) {
        if (binaryData === undefined)
            throw new BinaryDataError("Binary data not initialized");
        binaryData[0] = (version << 4) | reservedBits;
    }

    private static updateDateBinaryData(binaryData: Buffer, date: number) {
        if (binaryData === undefined)
            throw new BinaryDataError("Binary data not initialized");
        binaryData.writeUIntBE(date, 1, 5);
    }

    private static findFieldIndex(binaryData: Buffer, fieldType: fp.FieldType, minLength: number = 0): number | undefined {
        let index = CUBE_HEADER_LENGTH; // Start after the header
        while (index < binaryData.length) {
            const { type, length, valueStartIndex } = fp.readTLVHeader(binaryData, index);
            if (type === fieldType && length >= minLength) {
                return valueStartIndex; // Return the index of the start of the desired field value
            }
            index = valueStartIndex + length; // Move to the next field
        }
        return undefined; // Return undefined if the desired field is not found
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

    // Non-worker version kept for browser portability
    private async findValidHash(nonceStartIndex: number, signatureStartIndex: number | undefined = undefined): Promise<Buffer> {
        logger.trace("Running findValidHash (non-worker)");
        await sodium.ready;
        return new Promise((resolve) => {
            let nonce: number = 0;
            let hash: Buffer;
            // If this is a MUC and signatureStartIndex is provided, set fingerprint once before the loop starts
            if (signatureStartIndex !== undefined) {
                if (this.publicKey === undefined || this.privateKey === undefined) {
                    throw new Error("Public/private key not initialized");
                }
                this.writeFingerprint(this.publicKey, signatureStartIndex);
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
                        this.signBinaryData(this.privateKey!, signatureStartIndex);
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
export class InsufficientDifficulty extends CubeError { }

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