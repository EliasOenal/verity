// cube.ts
import { Settings } from '../settings';
import { NetConstants } from '../networking/networkDefinitions';

import { BinaryDataError, BinaryLengthError, CubeError, CubeKey, CubeSignatureError, CubeType, FieldError, FieldSizeError } from "./cubeDefinitions";
import { CubeInfo } from "./cubeInfo";
import * as CubeUtil from './cubeUtil';
import { CubeField, CubeFieldType } from "./cubeField";
import { CubeFields, coreFieldParsers, coreTlvFieldParsers } from './cubeFields';
import { CubeFamilyDefinition } from "./cubeFamily";

import { FieldParser } from "../fields/fieldParser";

import { logger } from '../logger';

import sodium, { KeyPair } from 'libsodium-wrappers-sumo'
import { Buffer } from 'buffer';

export interface CubeOptions {
    fields?: CubeFields | CubeField[] | CubeField,
    family?: CubeFamilyDefinition,
    requiredDifficulty?: number,
}

export class Cube {
    /**
     * Creates a new standard or "frozen" cube.
     * @param data Supply your custom fields here. We will supplement them
     * with all required boilerplate (i.e. we will create the TYPE, DATE and
     * NONCE fields for you).
     */
    static Frozen(options?: CubeOptions): Cube {
        // set options
        if (options === undefined) options = {};
        options.family = options?.family ?? coreCubeFamily;
        options.requiredDifficulty = options?.requiredDifficulty ?? Settings.REQUIRED_DIFFICULTY;
        // prepare fields
        options.fields = CubeFields.Frozen(
            options?.fields,  // include the user's custom fields, obviously
            options.family.parsers[CubeType.FROZEN].fieldDef);
        const cube: Cube = new options.family.cubeClass(CubeType.FROZEN, options);
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
               options?: CubeOptions,
    ): Cube {
        // set options
        if (options === undefined) options = {};
        options.family = options?.family ?? coreCubeFamily;
        options.requiredDifficulty = options?.requiredDifficulty ?? Settings.REQUIRED_DIFFICULTY;
        // upgrade keys to Buffer if required
        if (!(publicKey instanceof Buffer)) publicKey = Buffer.from(publicKey);
        if (!(privateKey instanceof Buffer)) privateKey = Buffer.from(privateKey);
        // create field set, then create cube
        options.fields = CubeFields.Muc(
            publicKey,
            options?.fields,  // include the user's custom fields, obviously
            options.family.parsers[CubeType.MUC].fieldDef);
        const cube: Cube = new options.family.cubeClass(CubeType.MUC, options);
        // supply private key
        cube.privateKey = privateKey as Buffer;
        return cube;
    }

    /**
     * Create a Persistant Immutable Cube, which is a type of smart cube used
     * for data to be made available long-term.
     */
    static PIC(options: CubeOptions): Cube {
        // TODO implement
        return undefined;
    }

    static Type(binaryCube: Buffer): CubeType {
        if (!(binaryCube instanceof Buffer)) return undefined;
        return binaryCube.readIntBE(0, NetConstants.CUBE_TYPE_SIZE);
    }

    readonly _cubeType: CubeType;
    get cubeType(): CubeType { return this._cubeType }

    readonly family: CubeFamilyDefinition;
    readonly fieldParser: FieldParser;

    readonly requiredDifficulty: number;

    protected _fields: CubeFields;
    public get fields(): CubeFields {
        // TODO: This is very dangerous as obviously accessing the raw fields
        // could manipulate the Cube. Maybe make CubeFields an
        // EventEmitter and mark the Cube manipulated on change events?
        return this._fields;
    }

    private binaryData: Buffer = undefined;

    private hash: Buffer = undefined;

    private _privateKey: Buffer = undefined;
    get privateKey() { return this._privateKey; }
    public set privateKey (privateKey: Buffer) { this._privateKey = privateKey; }
    get publicKey() { return this.fields.getFirst(CubeFieldType.PUBLIC_KEY)?.value; }

    /** Instatiate a Cube object based on an existing, binary cube */
    constructor(
        binaryData: Buffer,
        options?: CubeOptions);
    /**
     * Sculpt a new bare Cube, starting out without any fields.
     * This is only useful if for some reason you need full control even over
     * mandatory boilerplate fields. Consider using Cube.Frozen or Cube.MUC
     * instead, which will sculpt a fully valid frozen Cube or MUC, respectively.
     **/
    constructor(
        cubeType: CubeType,
        options?: CubeOptions);
    // Repeat implementation as declaration as calls must strictly match a
    // declaration, not the implementation (which is stupid)
    constructor(param1: Buffer | CubeType, option?: CubeOptions);
    constructor(
            param1: Buffer | CubeType,
            options?: CubeOptions)
    {
        // set options
        this.family = options?.family ?? coreCubeFamily;
        this.requiredDifficulty = options?.requiredDifficulty ?? Settings.REQUIRED_DIFFICULTY;
        if (param1 instanceof Buffer) {
            // existing cube, usually received from the network
            const binaryData = param1;
            if (binaryData.length !== NetConstants.CUBE_SIZE) {
                logger.info(`Cube: Cannot reactivate dormant (binary) Cube of size ${binaryData.length}, must be ${NetConstants.CUBE_SIZE}`);
                throw new BinaryLengthError(`Cannot reactivate dormant (binary) Cube of size ${binaryData.length}, must be ${NetConstants.CUBE_SIZE}`);
            }
            this.binaryData = binaryData;
            this._cubeType = Cube.Type(binaryData);
            if (!(this._cubeType in CubeType)) {
                logger.info(`Cube: Cannot reactivate dormant (binary) Cube of unknown type ${this._cubeType}`);
                throw new CubeError(`Cannot reactivate dormant (binary) Cube of unknown type ${this._cubeType}`)
            }
            this.fieldParser = this.family.parsers[this._cubeType];
            this._fields = this.fieldParser.decompileFields(this.binaryData) as CubeFields;
            if (!this._fields) {
                logger.info(`Cube: Could not decompile dormant (binary) Cube`);
                throw new BinaryDataError("Could not decompile dormant (binary) Cube");
            }
            this.hash = CubeUtil.calculateHash(binaryData);
            this.validateCube();
        } else {
            // sculpt new Cube
            this._cubeType = param1;
            this.fieldParser = this.family.parsers[this._cubeType];
            if (options?.fields) {  // do we have a field set already?
                if (!(options.fields instanceof CubeFields)) {
                    options.fields =
                        new this.fieldParser.fieldDef.fieldsObjectClass(
                            options.fields);  // upgrade to CubeFields if needed
                }
                this.setFields(options.fields as CubeFields);  // set fields
            }  // no fields yet? let's just start out with an empty set then
            else this._fields = new CubeFields([], this.fieldParser.fieldDef);
        }
    }

    toString(): string {
        let ret = "";
        if (this._cubeType == CubeType.FROZEN) ret = "Frozen Cube";
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
            family: CubeFamilyDefinition = this.family
    ): Promise<CubeInfo> {
        await this.getBinaryData();  // cube must be compiled to create a CubeInfo
        return new CubeInfo({
            key: await this.getKey(),
            cube: this,
            date: this.getDate(),
            challengeLevel: CubeUtil.countTrailingZeroBits(this.hash),
            family: family,
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

    // Note: Arguably, it might have been a better idea to make key generation
    // explicit rather than having getKey() async. But it's what we did and it's
    // pretty stable by now.
    public async getKey(): Promise<CubeKey> {
        if (this.cubeType == CubeType.MUC) {
            return this.publicKey;
        } else if (this.cubeType === CubeType.FROZEN) {
            return await this.getHash();
        } else {
            throw new CubeError("CubeType " + this.cubeType + " not implemented");
        }
    }
    public async getKeyString(): Promise<string> {
        return (await this.getKey()).toString('hex');
    }

    public getKeyIfAvailable(): CubeKey {
        if (this.cubeType == CubeType.MUC) {
            return this.publicKey;
        } else if (this.cubeType === CubeType.FROZEN) {
            return this.getHashIfAvailable();
        } else {
            throw new CubeError("CubeType " + this.cubeType + " not implemented");
        }
    }
    public getKeyStringIfAvailable(): string {
        return this.getKeyIfAvailable()?
            this.getKeyIfAvailable().toString('hex') : undefined;
    }

    public async getHash(): Promise<Buffer> {
        if (!this.binaryData || !this.hash) await this.compile();
        return this.hash;
    }

    public getHashIfAvailable(): Buffer {
        return this.hash;
    }

    public async getBinaryData(): Promise<Buffer> {
        if (!this.binaryData || !this.hash) await this.compile();
        return this.binaryData;
    }
    public getBinaryDataIfAvailable(): Buffer {
        return this.binaryData;
    }

    /**
     * Automatically add Padding to reach full Cube length.
     * You don't need to call that manually, we will do that for you whenever
     * you request binary data. It can however safely be called multiple times.
     */
    public padUp(): boolean {
        // pad up to 1024 bytes if necessary
        const len = this.fields.getByteLength();
        if (len < (NetConstants.CUBE_SIZE)) {  // any padding required?
            // start with a 0x00 single byte padding field to indicate end of CCI data
            this.fields.insertFieldBeforeBackPositionals(CubeField.Padding(1));
            // now add further padding as required
            const paddingRequired = NetConstants.CUBE_SIZE - len - 1;
            if (paddingRequired) this.fields.insertFieldBeforeBackPositionals(
                CubeField.Padding(paddingRequired));
            this.cubeManipulated();
            return true;
        } else return false;
    }

    /// @method Any change to a cube invalidates it and basically returns it to
    /// "new cube in the making" state. Binary data, hash and potentially cube key
    /// are now invalid. Delete them; out getter methods will make sure to
    /// recreate them when needed.
    /**
     * Needs to be called after any changes to Cube data that require
     * the Cube to be recompiled. Will be called automatically for our own
     * Setter methods, but if e.g. you manipulate the fields on your own then
     * this is up to you.
     */
    public cubeManipulated() {
        this.binaryData = undefined;
        this.hash = undefined;
    }

    /**
     * Compiles this Cube into a binary Buffer to be stored or transmitted
     * over the wire. This will also (re-)calculate this cube's hash challenge.
     * If required, it will also add padding and/or sign the Cube.
     * Can either be called explicitly or will be called automatically when
     * you try top getBinaryData() or getHash().
     **/
    public async compile(): Promise<void> {
        this.padUp();
        // compile it
        this.binaryData = this.fieldParser.compileFields(this._fields);
        if (Settings.RUNTIME_ASSERTIONS && this.binaryData.length != NetConstants.CUBE_SIZE) {
            throw new BinaryDataError("Cube: Something went horribly wrong, I just wrote a cube of invalid size " + this.binaryData.length);
        }
        // re-set our fields so they share the same memory as our binary data again
        for (const field of this.fields.all) {
            const offset =
                field.start + this.fieldParser.getFieldHeaderLength(field.type);
            field.value = this.binaryData.subarray(offset, offset + field.length);
        }
        this.signBinaryData();  // sign this Cube if applicable
        await this.generateCubeHash();
        if (Settings.RUNTIME_ASSERTIONS) {
            this.validateCube();
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
                    if (!this.verifySignature(
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
    private verifySignature(sig: Buffer, data: Buffer, pubkey:Buffer): boolean {
        return sodium.crypto_sign_verify_detached(sig, data, pubkey);
    }

    /**
     * Calculates the cube hash, including the hashcash challenge.
     * If this is a MUC, it also signs it.
     * It makes no sense to call this method more than once on any particular
     * cube object (except maybe to heat your home).
     * Cube's getter method will make sure to call generateCubeHash() whenever
     * appropriate (i.e. when the hash is required but has not yet been calculated).
     */
    private async generateCubeHash(): Promise<void> {
        if (this.binaryData === undefined) {
            logger.warn("Cube: generateCubeHash called on undefined binary data -- it's not a problem, but it's not supposed to happen either");
            this.compile();
        }
        const nonceField = this._fields.getFirst(CubeFieldType.NONCE);
        if (!nonceField) {
            logger.error('Cube: generateCubeHash() called, but no NONCE field found');
            throw new CubeError("generateCubeHash() called, but no NONCE field found");
        }
        // Calculate hashcash. If this is a MUC, this will also sign it.
        this.hash = await this.findValidHash(nonceField);
        // logger.info("cube: Using hash " + this.hash.toString('hex') + "as cubeKey");
    }

    /**
     * Signs this Cube if it has a SIGNATURE field.
     * Can safely be called for non-smart cubes, in which case it will simply
     * do nothing due to the lack of a SIGNATURE field.
     */
    private signBinaryData(): void {
        const signature: CubeField = this.fields.getFirst(CubeFieldType.SIGNATURE);
        if (!signature) return;  // no signature field, no signature
        if (Settings.RUNTIME_ASSERTIONS) {
            if (!this.binaryData) {
                throw new BinaryDataError("Cube: signBinaryData() called with undefined binary data");
            }
            if (!this.publicKey || !this.privateKey) {
                throw new CubeError("Cube: signBinaryData() called without a complete public/private key pair");
            }
            if (!signature.start) {
                // this matches both when start is undefined and when it's zero,
                // and in this case this is a good thing :)
                throw new BinaryDataError("Cube: signBinaryData() called with unfinalized fields");
            }
        }
        // Slice out data to be signed:
        // Start of cube till just before the signature field
        const dataToSign = this.binaryData.subarray(0, signature.start);
        signature.value.set(  // Generate the signature
            this.generateSignature(dataToSign, this.privateKey));
    }
    private generateSignature(data: Buffer, privkey: Buffer): Uint8Array {
        return sodium.crypto_sign_detached(data, privkey);
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
    findValidHash(nonceField: CubeField): Promise<Buffer> {
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
                    nonceField.value.writeUIntBE(nonce, 0, Settings.NONCE_SIZE);
                    // Calculate the hash
                    hash = CubeUtil.calculateHash(this.binaryData);
                    // Check if the hash is valid
                    if (CubeUtil.countTrailingZeroBits(hash) >= this.requiredDifficulty) {
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
        if (this.binaryData === undefined || this.hash === undefined) {
            this.compile();
        }
        return CubeUtil.countTrailingZeroBits(this.hash);
    }

}

// Note: Never move the family definitions to another file as they must be
// executed strictly after the Cube implementation. You may get uncaught
// ReferenceErrors otherwise.
export const coreCubeFamily: CubeFamilyDefinition = {
    cubeClass: Cube,
    parsers: coreFieldParsers,
}

export const coreTlvCubeFamily: CubeFamilyDefinition = {  // for testing only
    cubeClass: Cube,
    parsers: coreTlvFieldParsers,
}
