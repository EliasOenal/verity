// Block.ts
import { Buffer } from 'buffer';
import * as nacl from 'tweetnacl';
import { createHash } from 'crypto';
import { Settings } from './config';
import { logger } from './logger';
import path from 'path';
import { Worker } from 'worker_threads';
import { type } from 'os';
import { NetConstants } from './networkDefinitions';

export enum FieldType {
    PADDING_NONCE = 0x00 << 2,
    PAYLOAD = 0x01 << 2,
    RELATES_TO = 0x02 << 2,
    KEY_DISTRIBUTION = 0x03 << 2,
    SHARED_KEY = 0x04 << 2,
    ENCRYPTED = 0x05 << 2,
    TYPE_SIGNATURE = 0x06 << 2,
    TYPE_SPECIAL_BLOCK = 0x07 << 2,
    TYPE_PUBLIC_KEY = 0x08 << 2,
}

export const FIELD_LENGTHS: { [key: number]: number | undefined } = {
    [FieldType.PAYLOAD]: undefined,
    [FieldType.RELATES_TO]: 32,
    [FieldType.PADDING_NONCE]: undefined,
    [FieldType.KEY_DISTRIBUTION]: 40,
    [FieldType.SHARED_KEY]: 32,
    [FieldType.ENCRYPTED]: undefined,
    [FieldType.TYPE_SIGNATURE]: 72,
    [FieldType.TYPE_SPECIAL_BLOCK]: 0, // Just a single header byte
    [FieldType.TYPE_PUBLIC_KEY]: 32,
};

export enum SpecialBlockType {
    BLOCK_TYPE_MUB = 0x00,
    BLOCK_TYPE_IPB = 0x01,
    BLOCK_TYPE_RESERVED = 0x02,
    BLOCK_TYPE_RESERVED2 = 0x03,
}

interface FullField {
    type: FieldType;
    start: number; // Start of field as offset from beginning of block (binaryData)
    length: number;
    value: Buffer;
}

export interface Field {
    type: FieldType;
    length: number;
    value: Buffer;
}

export class Block {
    private version: number;
    private reservedBits: number;
    private date: number;
    private fields: Array<Field | FullField>;
    private binaryData: Buffer | undefined;
    private hash: Buffer | undefined;

    private static BLOCK_HEADER_LENGTH: number = 6;

    constructor(binaryData?: Buffer) {
        if (binaryData && binaryData.length !== 1024) {
            logger.error('Block must be 1024 bytes');
            throw new Error('Block must be 1024 bytes');
        }

        if (binaryData === undefined) {
            this.version = 0;
            this.reservedBits = 0;
            this.date = Math.floor(Date.now() / 1000);
            const num_alloc = NetConstants.BLOCK_SIZE - Block.BLOCK_HEADER_LENGTH - Block.getFieldHeaderLength(FieldType.PADDING_NONCE);
            this.fields = [{
                type: FieldType.PADDING_NONCE,
                length: num_alloc, value: Buffer.alloc(num_alloc)
            }];
            this.binaryData = undefined;
            this.hash = undefined;
        } else {
            this.binaryData = binaryData;
            this.hash = Block.calculateHash(binaryData);
            let verified = this.verifyBlockDifficulty();
            if (!verified) {
                logger.error('Block does not meet difficulty requirements');
                throw new Error("Block does not meet difficulty requirements");
            }
            this.version = binaryData[0] >> 4;
            this.reservedBits = binaryData[0] & 0xF;
            this.date = binaryData.readUIntBE(1, 5);
            this.fields = Block.parseTLVBinaryData(this.binaryData);
        }
        this.processTLVFields(this.fields, this.binaryData);
    }

    public static getFieldHeaderLength(fieldType: FieldType): number {
        return (FIELD_LENGTHS[fieldType] == undefined) ? 2 : 1;
    }

    private verifyFingerprint(publicKeyValue: Buffer, providedFingerprint: Buffer): void {
        let hash = createHash('sha3-256');
        let calculatedFingerprint = hash.update(publicKeyValue).digest().slice(0, 8);

        if (!calculatedFingerprint.equals(providedFingerprint)) {
            logger.error('Block: Fingerprint does not match');
            throw new Error('Block: Fingerprint does not match');
        }
    }

    private verifySignature(publicKeyValue: Buffer, signatureValue: Buffer, dataToVerify: Buffer): void {
        let isSignatureValid = nacl.sign.detached.verify(
            new Uint8Array(dataToVerify),
            new Uint8Array(signatureValue),
            new Uint8Array(publicKeyValue)
        );

        if (!isSignatureValid) {
            logger.error('Block: Invalid signature');
            throw new Error('Block: Invalid signature');
        }
    }

    // If binaryData is undefined, then this is a new local block in the process of being created.
    // If binaryData is defined, then we expect a fully formed block meeting all requirements.
    private processTLVFields(fields: Array<Field | FullField>, binaryData: Buffer | undefined): void {
        let mub: FullField | undefined = undefined;
        let publicKey: FullField | undefined = undefined;
        let signature: FullField | undefined = undefined;

        for (let field of fields) {
            switch (field.type) {
                case FieldType.PADDING_NONCE:
                case FieldType.PAYLOAD:
                    break;
                case FieldType.RELATES_TO:
                case FieldType.KEY_DISTRIBUTION:
                case FieldType.SHARED_KEY:
                case FieldType.ENCRYPTED:
                    logger.error('Block: Field not implemented ' + field.type);
                    throw new Error('Block: Fields not implemented ' + field.type);
                case FieldType.TYPE_SIGNATURE:
                    if ('start' in field && binaryData) {
                        if (field.start + field.length !== binaryData.length) {
                            logger.error('Block: Signature field is not the last field');
                            throw new Error('Block: Signature field is not the last field');
                        } else {
                            signature = field;
                        }
                    } else {
                        logger.error('Block: Signature field does not have start');
                        throw new Error('Block: Signature field does not have start');
                    }
                    break;
                case FieldType.TYPE_SPECIAL_BLOCK:
                    // has to be very first field
                    if ('start' in field) {
                        if (field.start !== Block.BLOCK_HEADER_LENGTH) {
                            logger.error('Block: Special block type is not the first field');
                            throw new Error('Block: Special block type is not the first field');
                        } else {
                            mub = field;
                        }
                    }
                    const specialBlockType = field.value[0] & 0x03;
                    if (specialBlockType !== SpecialBlockType.BLOCK_TYPE_MUB) {
                        logger.error('Block: Special block type not implemented ' + specialBlockType);
                        throw new Error('Block: Special block type not implemented ' + specialBlockType);
                    }
                    break;
                case FieldType.TYPE_PUBLIC_KEY:
                    // TODO: add to keystore
                    if ('start' in field) {
                        publicKey = field;
                    } else {
                        logger.error('Block: Public key field does not have start');
                        throw new Error('Block: Public key field does not have start');
                    }
                    break;
                default:
                    logger.error('Block: Unknown field type ' + field.type);
                    throw new Error('Block: Unknown field type ' + field.type);
            }
        }

        if (mub && publicKey && signature) {
            if (binaryData) {
                // Extract the public key, signature values and provided fingerprint
                let publicKeyValue = publicKey.value;
                let providedFingerprint = signature.value.slice(0, 8); // First 8 bytes of signature field
                let signatureValue = signature.value.slice(8); // Remaining bytes are the actual signature

                // Verify the fingerprint
                this.verifyFingerprint(publicKeyValue, providedFingerprint);

                // Create the data to be verified. 
                // It includes all bytes of the block from the start up to and including
                // the type byte of the signature field and the fingerprint.
                const fingerprintLength = 8;
                // From start of block up to the signature itself
                let dataToVerify = binaryData.slice(0, signature.start
                    + Block.getFieldHeaderLength(FieldType.TYPE_SIGNATURE + fingerprintLength));

                // Verify the signature
                this.verifySignature(publicKeyValue, signatureValue, dataToVerify);
            } else {
                logger.error('Block: binaryData is undefined');
                throw new Error('Block: binaryData is undefined');
            }
        }
    }

    public getVersion(): number {
        return this.version;
    }

    public setVersion(version: number): void {
        if (version !== 0) {
            logger.error('Only version 0 is supported');
            throw new Error("Only version 0 is supported");
        }
        this.binaryData = undefined;
        this.hash = undefined;
        this.version = version;
    }

    public getDate(): number {
        return this.date;
    }

    public setDate(date: number): void {
        const binaryData = undefined;
        this.hash = undefined;
        this.date = date;
    }

    public getFields(): Array<Field> {
        return this.fields;
    }

    public setFields(fields: Array<Field>): void {
        this.binaryData = undefined;
        this.hash = undefined;
        this.fields = fields;
        // verify all fields together are less than 1024 bytes
        let totalLength = Block.BLOCK_HEADER_LENGTH;
        for (let field of fields) {
            totalLength += field.length;
            totalLength += Block.getFieldHeaderLength(field.type);
        }
        if (totalLength > NetConstants.BLOCK_SIZE) {
            throw new Error('Block: Fields are ' + totalLength + ' bytes but must be less than ' + NetConstants.BLOCK_SIZE + ' bytes');
        } else if (totalLength != NetConstants.BLOCK_SIZE) { // Pad with padding nonce to reach 1024 bytes
            const num_alloc = NetConstants.BLOCK_SIZE - totalLength - 2;
            fields.push({
                type: FieldType.PADDING_NONCE,
                length: num_alloc, value: Buffer.alloc(num_alloc)
            });
        }
    }

    public async getHash(): Promise<Buffer> {
        if (this.hash !== undefined)
            return this.hash;
        if (this.binaryData === undefined) {
            this.binaryData = this.getBinaryData();
        }
        let index = this.findNonceFieldIndex(this.binaryData);
        if (index === null) {
            logger.error('No suitable PADDING_NONCE field found');
            throw new Error("No suitable PADDING_NONCE field found");
        }
        // Swap this out to the non-worker version if we don't have nodejs worker threads
        this.hash = await this.findValidHash(index);
        return this.hash;
    }

    public getBinaryData(): Buffer {
        if (this.binaryData === undefined) {
            this.binaryData = Buffer.alloc(1024);

            this.updateVersionBinaryData(this.version, this.reservedBits);
            this.updateDateBinaryData(this.date);
            this.updateTLVBinaryData(this.fields);
        }
        return this.binaryData;
    }

    async printBlockInfo() {
        console.log("Version: " + this.getVersion());
        console.log("Date: " + this.getDate());
        console.log("Fields: ");
        for (let field of this.fields) {
            console.log("    Type: " + field.type);
            console.log("    Length: " + field.length);
            //console.log("    Value: " + field.value.toString('hex'));
        }
        console.log("Hash: " + (await this.getHash()).toString('hex'));
    }

    private updateVersionBinaryData(version: number, reservedBits: number) {
        if (this.binaryData === undefined)
            throw new Error("Binary data not initialized");
        this.binaryData[0] = (version << 4) | reservedBits;
    }

    private updateDateBinaryData(date: number) {
        if (this.binaryData === undefined)
            throw new Error("Binary data not initialized");
        this.binaryData.writeUIntBE(date, 1, 5);
    }

    private updateTLVBinaryData(fields: Array<{ type: FieldType; length: number; value: Buffer }>): void {
        if (this.binaryData === undefined)
            throw new Error("Binary data not initialized");
        let index = Block.BLOCK_HEADER_LENGTH; // Start after date field
        for (let field of fields) {
            let { nextIndex } = this.writeTLVHeader(field.type, field.length, index);
            index = nextIndex;

            if (index + field.length <= this.binaryData.length) {
                // Write value
                field.value.copy(this.binaryData, index);
                index += field.length;
            } else {
                logger.error(field.type + " field is too large, got " + field.length + " bytes, need " + (this.binaryData.length - index) + " bytes");
                throw new Error("Insufficient space in binaryData, got " + (index) + " bytes, need " + (index + field.length) + " bytes");
            }
        }
        // verify block is full
        if (index != this.binaryData.length) {
            logger.error("Block is not full, got " + index + " bytes, need " + this.binaryData.length + " bytes");
            throw new Error("Block is not full, got " + index + " bytes, need " + this.binaryData.length + " bytes");
        }
    }

    private writeTLVHeader(type: number, length: number, index: number): { nextIndex: number } {
        if (this.binaryData === undefined)
            throw new Error("Binary data not initialized");
        let implicitLength = FIELD_LENGTHS[type];
        if (implicitLength === undefined) {
            // Write type and length
            this.binaryData.writeUInt16BE((length & 0x03FF), index);
            this.binaryData[index] |= (type & 0xFC);
            index += 2;
        } else {
            // Write only type
            this.binaryData[index] = type;
            index += 1;
        }
        return { nextIndex: index };
    }

    private static parseTLVBinaryData(binaryData: Buffer): Array<Field | FullField> {
        if (binaryData === undefined)
            throw new Error("Binary data not initialized");
        let fields = []; // Clear any existing fields
        let index = Block.BLOCK_HEADER_LENGTH; // Start after date field
        while (index < binaryData.length) {
            const { type, length, valueStartIndex } = Block.readTLVHeader(binaryData, index);
            const start = index; // Start of TLV field
            index = valueStartIndex;

            if (index + length <= binaryData.length) {  // Check if enough data for value field
                let value = binaryData.slice(index, index + length);
                fields.push({ type: type, start: start, length: length, value: value });
                index += length;
            } else {
                throw new Error("Data ended unexpectedly while reading value of field");
            }
        }
        return fields;
    }

    private static readTLVHeader(binaryData: Buffer, index: number): { type: number, length: number, valueStartIndex: number } {
        // We first parse just type in order to detect whether a length field is present.
        // If the length field is present, we parse two bytes:
        // the first byte contains 6 bits of type information
        // and the last two bits of the first byte and the second byte contain the length
        // information.
        let type = binaryData[index] & 0xFC;
        if (!(type in FieldType))
            throw new Error("Invalid TLV type");
        let implicit = FIELD_LENGTHS[type];
        let length: number;
        if (implicit === undefined) {
            // Parse length
            length = binaryData.readUInt16BE(index) & 0x03FF;
            index += 2;
        } else { // Implicit length saved one byte
            length = implicit;
            index += 1;
        }
        return { type, length, valueStartIndex: index };
    }

    private findNonceFieldIndex(binaryData: Buffer): number | null {
        let index = Block.BLOCK_HEADER_LENGTH; // Start after date field
        while (index < binaryData.length) {
            const { type, length, valueStartIndex } = Block.readTLVHeader(binaryData, index);
            if (type === FieldType.PADDING_NONCE && length >= 4) {
                return valueStartIndex; // Return the index of the start of the PADDING_NONCE field value
            }
            index = valueStartIndex + length; // Move to the next field
        }
        return null; // Return null if no suitable PADDING_NONCE field is found
    }

    public static countTrailingZeroBits(buffer: Buffer): number {
        let count = 0;
        let byte = 0xFF;
        for (let i = buffer.length - 1; i >= 0; i--) {
            byte = buffer[i];
            if (byte === 0) {
                count += 8;
            } else {
                break;
            }
        }
        // Count trailing zero bits in the last non-zero byte
        for (let j = 0; j < 8; j++) {
            if ((byte & 1) === 0) {
                count++;
                byte >>= 1;
            } else {
                break;
            }
        }
        return count;
    }

    // Non-worker version kept for browser portability
    private async findValidHash(nonceStartIndex: number): Promise<Buffer> {
        return new Promise((resolve) => {
            let nonce: number = 0;
            let hash: Buffer;
            const checkHash = () => {
                if (this.binaryData === undefined) {
                    throw new Error("Binary data not initialized");
                }
                // Check 1000 hashes before yielding control back to the event loop
                for (let i = 0; i < 1000; i++) {
                    // Write the nonce to binaryData
                    this.binaryData.writeUInt32BE(nonce, nonceStartIndex);
                    // Calculate the hash
                    hash = Block.calculateHash(this.binaryData);
                    // Check if the hash is valid
                    if (Block.countTrailingZeroBits(hash) >= Settings.REQUIRED_DIFFICULTY) {
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

    private async findValidHashWorker(nonceStartIndex: number): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            if (this.binaryData === undefined) {
                logger.error("Binary data not initialized");
                throw new Error("Binary data not initialized");
            }

            const workerFilePath = path.resolve('./HashWorker.js');

            const worker = new Worker(workerFilePath, {
                workerData: {
                    binaryData: this.binaryData.buffer,  // Pass the underlying ArrayBuffer
                    nonceStartIndex: nonceStartIndex,
                    requiredDifficulty: Settings.REQUIRED_DIFFICULTY
                },
                transferList: [this.binaryData.buffer]  // Transfer ownership of the ArrayBuffer to the worker
            });

            worker.on('message', (message) => {
                this.hash = Buffer.from(message.hash);
                this.binaryData = Buffer.from(message.binaryData);
                logger.debug("Worker found valid hash, worker ID: " + worker.threadId + " hash: " + this.hash.toString('hex'));
                // Our old binaryData is now invalid, so we replace it with the new one
                resolve(this.hash);
            });
            worker.on('error', (err) => {
                logger.error("Worker error: " + err.message);
                reject(err);
            });
            worker.on('exit', (code) => {
                if (code != 0) {
                    logger.error(`Worker stopped with exit code ${code}`);
                    reject(new Error(`Worker stopped with exit code ${code}`));
                }
            });
        });
    }

    private static calculateHash(data: Buffer): Buffer {
        const hasher = createHash('sha3-256');
        hasher.update(data);
        return hasher.digest();
    }

    private verifyBlockDifficulty(): boolean {
        if (this.binaryData === undefined)
            throw new Error("Binary data not initialized");
        // Only calculate the hash if it has not been calculated yet
        if (this.hash === undefined)
            this.hash = Block.calculateHash(this.binaryData);

        // Check the trailing zeroes
        return Block.countTrailingZeroBits(this.hash) >= Settings.REQUIRED_DIFFICULTY;
    }

    public static blockLifetime(d1: number, d2: number, c1: number, c2: number, x: number): number {
        // Calculate the base-2 logarithms
        let log2_c1 = Math.log2(c1);
        let log2_c2 = Math.log2(c2);
        let log2_x = Math.log2(x);

        // Calculate the number of days the block lives
        let days = ((d1 - d2) * log2_x / (log2_c1 - log2_c2)) + ((d1 * log2_c2 - d2 * log2_c1) / (log2_c2 - log2_c1));

        return days;
    }

}
