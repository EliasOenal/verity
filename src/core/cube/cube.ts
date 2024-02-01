// cube.ts
import { BinaryDataError, BinaryLengthError, CubeError, CubeKey, CubeSignatureError, CubeType, FieldError, FieldNotImplemented, FieldSizeError,  SmartCubeError, SmartCubeTypeNotImplemented, UnknownFieldType } from "./cubeDefinitions";
import { Settings } from '../settings';
import { NetConstants } from '../networking/networkDefinitions';
import { CubeInfo } from "./cubeInfo";
import * as CubeUtil from './cubeUtil';
import { CubeField, CubeFieldLength, CubeFieldType, CubeFields, FieldParserTable, coreFieldParsers } from './cubeFields';
import { FieldParser } from "../fieldParser";
import { logger } from '../logger';

import { isBrowser, isNode, isWebWorker, isJsDom, isDeno } from "browser-or-node";
import sodium, { KeyPair } from 'libsodium-wrappers'
import { Buffer } from 'buffer';

if (isNode && Settings.HASH_WORKERS) {
    await import ('../nodespecific/cube-extended');
}

export class Cube {
    class = Cube;  // javascript introspection sucks

    /**
     * Creates a new standard or "dumb" cube.
     * @param data Supply your custom fields here. We will supplement them
     * with all required boilerplate (i.e. we will create the TYPE, DATE and
     * NONCE fields for you).
     */
    static Dumb(
            data: CubeFields | CubeField[] | CubeField = [],
            parsers: FieldParserTable = coreFieldParsers,
            cubeClass: any = Cube,  // type: class
            required_difficulty = Settings.REQUIRED_DIFFICULTY): Cube {
        data = CubeFields.Dumb(data, parsers[CubeType.DUMB].fieldDef);
        const cube: Cube = new cubeClass(CubeType.DUMB, parsers, required_difficulty);
        cube.setFields(data);
        return cube;
    }

    /**
     * Create a new Mutable User Cube, which is a type of smart cube the owner
     * can edit even after it was sculpted and published.
     * @param data Supply your custom fields here. We will supplement them
     * with all required boilerplate.
     */
    static MUC(publicKey: Buffer | Uint8Array,
               privateKey: Buffer | Uint8Array,
               data: CubeFields | CubeField[] | CubeField = [],
               parsers: FieldParserTable = coreFieldParsers,
               cubeClass: any = Cube,  // type: class
               required_difficulty = Settings.REQUIRED_DIFFICULTY): Cube {
        if (!(publicKey instanceof Buffer)) publicKey = Buffer.from(publicKey);
        if (!(privateKey instanceof Buffer)) privateKey = Buffer.from(privateKey);
        data = CubeFields.Muc(publicKey, data, parsers[CubeType.MUC].fieldDef);
        const cube: Cube = new cubeClass(CubeType.MUC, parsers, required_difficulty);
        cube.privateKey = privateKey as Buffer;
        cube.setFields(data);
        return cube;
    }

    /**
     * Create an Immutable Persistant Cube, which is a type of smart cube used
     * for data to be made available long-term.
     */
    static PIC(required_difficulty = Settings.REQUIRED_DIFFICULTY): Cube {
        // TODO implement
        return undefined;
    }

    static Type(binaryCube: Buffer): CubeType {
        if (!(binaryCube instanceof Buffer)) return undefined;
        return binaryCube.readIntBE(0, NetConstants.CUBE_TYPE_SIZE);
    }

    readonly _cubeType: CubeType;
    get cubeType(): CubeType { return this._cubeType }

    readonly fieldParser: FieldParser;

    protected _fields: CubeFields;
    public get fields(): CubeFields { return this._fields; }

    private binaryData: Buffer = undefined;

    private hash: Buffer = undefined;

    private _privateKey: Buffer = undefined;
    get privateKey() { return this._privateKey; }
    public set privateKey (privateKey: Buffer) { this._privateKey = privateKey; }
    get publicKey() { return this.fields.getFirst(CubeFieldType.PUBLIC_KEY)?.value; }

    /** Instatiate a Cube object based on an existing, binary cube */
    constructor(
        binaryData: Buffer,
        parsers?: FieldParserTable,
        required_difficulty?: number);
    /**
     * Sculpt a new bare Cube, starting out without any fields.
     * This is only useful if for some reason you need full control even over
     * mandatory boilerplate fields. Consider using Cube.Dumb or Cube.MUC
     * instead, which will sculpt a fully valid dumb Cube or MUC, respectively.
     **/
    constructor(
        cubeType: CubeType,
        parsers?: FieldParserTable,
        required_difficulty?: number);
    constructor(
            param1: Buffer | CubeType,
            readonly parsers: FieldParserTable = coreFieldParsers,
            readonly required_difficulty = Settings.REQUIRED_DIFFICULTY)
    {
        if (param1 instanceof Buffer) {
            // existing cube, usually received from the network
            const binaryData = param1;
            if (binaryData.length !== NetConstants.CUBE_SIZE) {
                logger.info(`Cube: Cannot construct Cube of size ${binaryData.length}, must be ${NetConstants.CUBE_SIZE}`);
                throw new BinaryLengthError(`Cannot construct Cube of size ${binaryData.length}, must be ${NetConstants.CUBE_SIZE}`);
            }
            this.binaryData = binaryData;
            this._cubeType = Cube.Type(binaryData);
            if (!(this._cubeType in CubeType)) {
                logger.info(`Cube: Cannot construct cube object of unknown type ${this._cubeType}`);
                throw new CubeError(`Cannot construct cube object of unknown type ${this._cubeType}`)
            }
            this.fieldParser = parsers[this._cubeType];
            this._fields = this.fieldParser.decompileFields(this.binaryData);
            if (!this._fields) throw new BinaryDataError("Could not decompile binary Cube");
            this.hash = CubeUtil.calculateHash(binaryData);
            this.validateCube();
        } else {
            // sculpt new Cube
            this._cubeType = param1;
            this.fieldParser = parsers[this._cubeType];
            this._fields = new CubeFields([], this.fieldParser.fieldDef);
        }
    }

    toString(): string {
        let ret = "";
        if (this._cubeType == CubeType.DUMB) ret = "Dumb Cube";
        else if (this._cubeType == CubeType.MUC) ret = "MUC";
        else if (this._cubeType == CubeType.PIC) ret = "PIC";
        else ret = "Invalid or unknown type of Cube"
        ret += ` containing ${this.fields.toString()}`;
        return ret;
    }
    toLongString(): string {
        return this.toString() + '\n' + this.fields.fieldsToLongString();
    }

    // This is only used (or useful) for locally created cubes.
    // It will create a CubeInfo object for our new cube once we found the
    // cube key, which involves the hashcash proof of work and therefore can
    // take a little while.
    public async getCubeInfo(
            parsers: FieldParserTable = this.parsers
    ): Promise<CubeInfo> {
        await this.getBinaryData();  // cube must be compiled to create a CubeInfo
        return new CubeInfo({
            key: await this.getKey(),
            cube: this,
            date: this.getDate(),
            challengeLevel: CubeUtil.countTrailingZeroBits(this.hash),
            parsers: parsers,
        });
    }

    // maybe TODO: get rid of this? This just returns a field, why the special treatment?
    public getDate(): number {
        const dateField: CubeField =
            this.fields.getFirst(CubeFieldType.DATE);
        return dateField.value.readUIntBE(0, NetConstants.TIMESTAMP_SIZE);
    }

    // maybe TODO: get rid of this? This just manipulates a field, why the special treatment?
    public setDate(date: number): void {
        this.cubeManipulated();
        const dateField: CubeField =
            this.fields.getFirst(CubeFieldType.DATE);
        dateField.value.fill(0);
        dateField.value.writeUIntBE(date,  0, NetConstants.TIMESTAMP_SIZE);
    }

    public setFields(fields: CubeFields | CubeField): void {
        if (fields instanceof CubeFields) fields = fields;
        else if (fields instanceof CubeField) fields = new CubeFields(fields, this.fieldParser.fieldDef);
        else throw TypeError("Invalid fields type");

        if (Settings.RUNTIME_ASSERTIONS) { // TODO: Double-check that it's okay to make these checks optional, i.e. they are not required for input sanitization
            // verify all fields together are less than 1024 bytes
            let totalLength = fields.getByteLength();
            if (totalLength > NetConstants.CUBE_SIZE) {
                throw new FieldSizeError(`Cube.setFields(): Can set fields with a total length of ${totalLength} as Cube size is ${NetConstants.CUBE_SIZE}`);
            }
            // verify there's a NONCE field
            if (!(fields.getFirst(CubeFieldType.NONCE))) {
                throw new FieldError("Cube.setFields(): Cannot sculpt Cube without a NONCE field");
            }
        }
        // All good, set fields
        this.cubeManipulated();
        this._fields = fields;
    }

    // TODO: Having something as simple as getKey() async keeps causing hickups.
    // We should make hash generation explicit and getKey() immediate.
    public async getKey(): Promise<CubeKey> {
        if (this.cubeType == CubeType.MUC) {
            return this.publicKey;
        } else if (this.cubeType === CubeType.DUMB) {
            return await this.getHash();
        } else {
            throw new CubeError("CubeType " + this.cubeType + " not implemented");
        }
    }

    public getKeyIfAvailable(): CubeKey {
        if (this.cubeType == CubeType.MUC) {
            return this.publicKey;
        } else if (this.cubeType === CubeType.DUMB) {
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
    public getBinaryDataIfAvailable(): Buffer {
        return this.binaryData;
    }

    /**
     * Automatically add Padding to reach full Cube length.
     * You don't need to call that manually, we will do that for you whenever
     * you request binary data.
     */
    public padUp(): boolean {
        // pad up to 1024 bytes if necessary
        const len = this.fields.getByteLength();
        if (len < (NetConstants.CUBE_SIZE)) {
            this.fields.insertFieldBeforeBackPositionals(
                CubeField.Padding(NetConstants.CUBE_SIZE - len));
            this.cubeManipulated();
            return true;
        } else return false;
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
        this.padUp();
        // compile it
        this.binaryData = this.fieldParser.compileFields(this._fields);
        if (this.binaryData.length != NetConstants.CUBE_SIZE) {
            throw new BinaryDataError("Cube: Something went horribly wrong, I just wrote a cube of invalid size " + this.binaryData.length);
        }
        await this.generateCubeHash();  // if this is a MUC, this also signs it

        // re-set our fields so they share the same memory as our binary data
        for (const field of this.fields.all) {
            const offset =
                field.start + this.fieldParser.getFieldHeaderLength(field.type);
            field.value = this.binaryData.subarray(offset, offset + field.length);
        }
    }

    private validateCube(): void {
        const publicKey: CubeField = this._fields.getFirst(CubeFieldType.PUBLIC_KEY);
        const signature: CubeField = this._fields.getFirst(CubeFieldType.SIGNATURE);

        if (this.cubeType === CubeType.MUC) {
            if (publicKey && signature) {
                if (this.binaryData) {
                    // Slice out data to be verified
                    // (start of Cube until just before the signature field)
                    const dataToVerify = this.binaryData.subarray(
                        0, signature.start);

                    // Verify the signature
                    if (!sodium.crypto_sign_verify_detached(
                        signature.value, dataToVerify, publicKey.value)) {
                            logger.error('Cube: Invalid signature');
                            throw new CubeSignatureError('Cube: Invalid signature');
                    }
                }
            } else {
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

        const paddingField = this._fields.getFirst(CubeFieldType.NONCE);
        if (!paddingField) {
            logger.error('Cube: generateCubeHash() called, but no PADDING_NONCE field found');
            throw new CubeError("generateCubeHash() called, but no PADDING_NONCE field found");
        }
        const indexNonce = paddingField.start +
            this.fieldParser.getFieldHeaderLength(CubeFieldType.NONCE);

        // Calculate hashcash
        this.hash = await this.findValidHash(indexNonce);
        // logger.info("cube: Using hash " + this.hash.toString('hex') + "as cubeKey");
    }

    private signBinaryData(): void {
        const signature: CubeField = this.fields.getFirst(CubeFieldType.SIGNATURE);
        if (Settings.RUNTIME_ASSERTIONS) {
            if (!this.binaryData) {
                throw new BinaryDataError("Cube: signBinaryData() called with undefined binary data");
            }
            if (!signature) return;  // no signature field = no signature
            if (!this.publicKey || !this.privateKey) {
                throw new CubeError("Cube: signBinaryData() called without a complete public/private key pair");
            }
            if (!signature.start) {
                // this matches both when start is undefined and when it's zero,
                // and in this case this is a good thing :)
                throw new BinaryDataError("Cube: signBinaryData() called with unfinalized fields");
            }
            if (this.binaryData === undefined) {
                throw new BinaryDataError("Binary data not initialized");
            }
        }

        // Slice out data to be signed:
        // Start of cube till just before the signature field
        const dataToSign = this.binaryData.subarray(0, signature.start);
        // Generate the signature
        // Note: As an exception, we need to work directly on a binary data
        // offset as this method usually gets called right after binary data
        // compilation. In this very instance, signature.value does temporarily
        // not point to a region of memory within binary data.
        this.binaryData.set(
            sodium.crypto_sign_detached(dataToSign, this.privateKey),
            signature.start);
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
    findValidHash(nonceStartIndex: number): Promise<Buffer> {
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
                    this.binaryData.writeUIntBE(nonce, nonceStartIndex, Settings.NONCE_SIZE);
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
