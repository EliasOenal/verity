// cube.ts
import { ApiMisuseError, Settings } from '../settings';
import { NetConstants } from '../networking/networkDefinitions';

import type { Veritable } from './veritable.definition';

import { FieldEqualityMetric, FieldPosition, FieldsEqualOptions } from '../fields/baseFields';
import { BinaryDataError, BinaryLengthError, CubeError, CubeFieldLength, CubeFieldType, CubeKey, CubeSignatureError, CubeType, DEFAULT_CUBE_TYPE, FieldError, FieldSizeError, HasNotify, HasSignature, SmartCubeError, ToggleNotifyType } from "./cube.definitions";
import { CubeInfo } from "./cubeInfo";
import * as CubeUtil from './cubeUtil';
import { CubeField } from "./cubeField";
import { CoreFieldParsers, CubeFamilyDefinition, CubeFields } from './cubeFields';

import type { FieldDefinition, FieldParser } from "../fields/fieldParser";

import { logger } from '../logger';

import sodium from 'libsodium-wrappers-sumo'
import { Buffer } from 'buffer';
import { FieldType } from '../../cci/cube/cciCube.definitions';
import { asCubeKey } from './keyUtil';

export interface CubeOptions {
    fields?: CubeFields | CubeField[] | CubeField,
    family?: CubeFamilyDefinition,
    requiredDifficulty?: number,
}

export interface CubeCreateOptions extends CubeOptions {
    cubeType?: CubeType,
    publicKey?: Buffer,
    privateKey?: Buffer,
}

export abstract class VeritableBaseImplementation implements Veritable {
    protected _fields: CubeFields;
    readonly options: CubeCreateOptions;


    constructor(options: CubeCreateOptions);
    constructor(copyFrom: VeritableBaseImplementation);
    constructor(param1?: CubeCreateOptions|VeritableBaseImplementation);
    constructor(param1: CubeCreateOptions|VeritableBaseImplementation = {}) {
        if (param1 instanceof VeritableBaseImplementation) {
            // copy constructor:
            // copy options object
            if (param1.options) this.options = {...param1.options};
            // copy-construct fields
            const fieldsType = (param1._fields.constructor) as typeof CubeFields;
            this._fields = new fieldsType(param1._fields);
        } else {
            // construction from scratch
            this.options = param1;
            // set default options
            this.options.cubeType ??= DEFAULT_CUBE_TYPE;
            this.options.family ??= coreCubeFamily;
            this.options.requiredDifficulty ??= Settings.REQUIRED_DIFFICULTY;

            // initialise members
            this._fields = this.normalizeFields(this.options.fields);

            // ensure Cube type is of a notification variant if there is a
            // NOTIFY field
            if (this._fields.getFirst(FieldType.NOTIFY) && !HasNotify[this.options.cubeType]) {
                this.options.cubeType = ToggleNotifyType[this.options.cubeType];
            }
        }
    }

    get family(): CubeFamilyDefinition { return this.options.family }
    get cubeType(): CubeType { return this.options.cubeType }
    get requiredDifficulty(): number { return this.options.requiredDifficulty }

    get fieldParser(): FieldParser {
        return this.family.parsers[this.cubeType];
    }

    get publicKey(): Buffer { return this.options.publicKey }
    get privateKey(): Buffer { return this.options.privateKey }

    public getDate(): number {
        const dateField: CubeField =
            this.getFirstField(CubeFieldType.DATE);
        if (dateField === undefined) return undefined;
        try {
            const val: number = dateField.value.readUIntBE(0, NetConstants.TIMESTAMP_SIZE);
            return val;
        } catch (e) {
            logger.debug("VeritableBaseImplementation.getDate(): Cannot read date field; returning undefined. Error was: " + e);
            return undefined;
        }
    }

    /** Subclass must override */
    getKeyIfAvailable(): CubeKey {
        throw new ApiMisuseError("VeritableBaseImplementation subclasses must implement getKeyIfAvailable()");
    }
    /** Subclass must override */
    getKeyStringIfAvailable(): string {
        throw new ApiMisuseError("VeritableBaseImplementation subclasses must implement getKeyStringIfAvailable()");
    }
    /** Subclass must override */
    getKey(): Promise<CubeKey> {
        throw new ApiMisuseError("VeritableBaseImplementation subclasses must implement getKey()");
    }
    /** Subclass must override */
    getKeyString(): Promise<string> {
        throw new ApiMisuseError("VeritableBaseImplementation subclasses must implement getKeyString()");
    }

    equals(other: Veritable&VeritableBaseImplementation, options?: FieldsEqualOptions): boolean {
        // Cubes of different types are not equal
        if (this.cubeType !== other.cubeType) return false;

        // Note: NOT comparing families as those describe purely local rules;
        //   also, if we did, we'd have to ensure to actually compare family
        //   rules rather than family object addresses.

        // Compare key according to the following rules:
        // - Two Verita with different keys are not equal
        if (
            this.getKeyIfAvailable() && other.getKeyIfAvailable() &&
            !this.getKeyIfAvailable().equals(other.getKeyIfAvailable())
        ) return false;
        // - If one Veritum knows its key and the other doesn't,
        //   they are not equal
        if (
            (!this.getKeyIfAvailable() && other.getKeyIfAvailable()) ||
            (this.getKeyIfAvailable() && !other.getKeyIfAvailable())
        ) return false;
        // Note: On the other hand:
        // - two Verita with the same key can obviously be equal; and
        // - less obviously, two Verita who both don't know their key
        //   (e.g. due to both being uncompiled) can be equal

        // Compare fields
        if (!this.fieldsEqual(other, options)) return false;

        return true;  // all checks passed
    }

    /** Subclass should override */
    compile(): Promise<any> {
        return Promise.resolve();
    }

    fieldsEqual(
            other: VeritableBaseImplementation,
            options: FieldsEqualOptions = {},
    ): boolean {
        return this._fields.equals(other._fields, options);
    }

    get fieldCount(): number { return this._fields.length }

    get byteLength(): number { return this._fields.getByteLength() }

    getFieldLength(fields?: CubeField | CubeField[]): number {
        return this._fields.getByteLength(fields);
    }

    getFields(type?: number | number[]): Iterable<CubeField> {
        return this._fields.get(type);
    }

    getFirstField(type: Number): CubeField {
        return this._fields.getFirst(type);
    }

    sliceFieldsBy(type: Number, includeBefore?: boolean): Iterable<CubeFields> {
        return this._fields.sliceBy(type, includeBefore);
    }

    appendField(field: CubeField): void {
        return this._fields.appendField(field);
    }

    insertFieldInFront(field: CubeField): void {
        return this._fields.insertFieldInFront(field);
    }

    insertFieldAfterFrontPositionals(field: CubeField): void {
        return this._fields.insertFieldAfterFrontPositionals(field);
    }

    insertFieldBeforeBackPositionals(field: CubeField): void {
        return this._fields.insertFieldBeforeBackPositionals(field);
    }

    insertFieldBefore(type: number, field: CubeField): void {
        return this._fields.insertFieldBefore(type, field);
    }

    insertField(position: FieldPosition, ...fields: CubeField[]): void {
        return this._fields.insertField(position, ...fields);
    }
    ensureFieldInFront(type: number, defaultField: CubeField | FieldDefinition): void {
        return this._fields.ensureFieldInFront(type, defaultField);
    }

    ensureFieldInBack(type: number, defaultField: CubeField | FieldDefinition): void {
        return this._fields.ensureFieldInBack(type, defaultField);
    }

    removeField(index: number): void;
    removeField(field: CubeField): void;
    removeField(field: number|CubeField): void {
        return this._fields.removeField(field);
    }

    /**
     * Subclasses should override this method to perform any necessary
     * state changes required due to the fact that the field set may now
     * be changes by application layer code in an unpredictable way.
     */
    manipulateFields(): CubeFields {
        return this._fields;
    }

    protected normalizeFields(
            fields: CubeField | CubeField[] | CubeFields | undefined,
    ): CubeFields {
        return CubeFields.NormalizeFields(
            fields, this.fieldParser.fieldDef) as CubeFields;
    }
  }

export class Cube extends VeritableBaseImplementation implements Veritable {
    /**
     * Creates a new fully valid Cube of your chosen type.
     * @param type Which type of Cube would you like?
     *   Notify/Non-notify variant will be adjusted automatically based on
     *   whether options.fields contains a NOTIFY field.
     * @param options - Supply any optional information here.
     *   This includes your Cube fields as options.fields -- we will supplement
     *   them with all required boilerplate (i.e. we will create all mandatory
     *   positional fields like DATE and NONCE, and depending on the Cube type
     *   maybe something like PUBLIC_KEY or SIGNATURE).
     * @returns A fully valid, instantly compileable Cube.
     * @throws {ApiMisuseError} If requesting a signature-bearing smart Cube
     *   but not supplying a key pair.
     */
    static Create(
        options: CubeCreateOptions = {},
    ): Cube {
        options = Object.assign({}, options);  // copy options to avoid messing up original
        // set default options
        options.cubeType ??= DEFAULT_CUBE_TYPE;
        options.family ??= coreCubeFamily;
        options.requiredDifficulty ??= Settings.REQUIRED_DIFFICULTY;

        const fieldDef: FieldDefinition =
            options.family.parsers[options.cubeType].fieldDef;

        // normalise input:
        // - ensure fields is an instance of the family-specified Fields class
        // maybe TODO: skip the copy if already correct type?
        options.fields = new fieldDef.fieldsObjectClass(options.fields, fieldDef);

        // - on signed types, recognise implicitly supplied public key
        if (HasSignature[options.cubeType] && !options.publicKey) {
            options.publicKey = CubeFields.getFirst(
                options.fields, CubeFieldType.PUBLIC_KEY)?.value;
        }
        // upgrade keys to Buffer if required
        if (options.publicKey && !(options.publicKey instanceof Buffer)) {
            options.publicKey = Buffer.from(options.publicKey);
        }
        if (options.privateKey && !(options.privateKey instanceof Buffer)) {
            options.privateKey = Buffer.from(options.privateKey);
        }

        // validate input: signed types require a key pair
        if (HasSignature[options.cubeType]) {
            if (!options.publicKey || !options.privateKey ||
                options.publicKey?.length !== NetConstants.PUBLIC_KEY_SIZE) {
                throw new ApiMisuseError(`Cube.Create(): cannot create a ${CubeType[options.cubeType]} without a valid public/private key pair`);
            }
        }

        // auto-correct supplied CubeType to the notify or non-notify variant if necessary
        options.cubeType =
            CubeFields.CorrectNotifyType(options.cubeType, options.fields);

        // on signed types, ensure public key field is present
        if (HasSignature[options.cubeType]) {
            (options.fields as CubeFields).ensureFieldInBack(
                CubeFieldType.PUBLIC_KEY, fieldDef.fieldObjectClass.PublicKey());
            // set public key field content; this will enforce the
            // options-supplied public key (even in case of conflicting field)
            const pubkeyField = (options.fields as CubeFields).getFirst(CubeFieldType.PUBLIC_KEY);
            pubkeyField.value = Buffer.from(options.publicKey);
        }
        // supply any default fields that might be missing
        options.fields = CubeFields.DefaultPositionals(
            options.family.parsers[options.cubeType].fieldDef,
            options?.fields,  // include the user's custom fields, obviously
        ) as CubeFields;

        // sculpt Cube
        const cube: Cube = new options.family.cubeClass(options.cubeType, options);

        // on signed types, supply private key
        if (HasSignature[options.cubeType]) cube.privateKey = options.privateKey as Buffer;

        return cube;  // all done, finally :)
    }

    /**
     * Creates a new standard or "frozen" cube, or a frozen notify Cube.
     * @param data - Supply your custom fields here. We will supplement them
     * with all required boilerplate (i.e. we will create the TYPE, DATE and
     * NONCE fields for you).
     * If data contains a NOTIFY field, the resulting Cube will be a notify Cube.
     * @deprecated Use Create() directly please
     */
    static Frozen(options: CubeCreateOptions = {}): Cube {
        options.cubeType = CubeType.FROZEN;
        return this.Create(options);
    }

    /**
     * Create a new Mutable User Cube, which is a type of smart cube the owner
     * can edit even after it was sculpted and published.
     * @param data Supply your custom fields here. We will supplement them
     * with all required boilerplate.
     * If data contains a NOTIFY field, the resulting Cube will be a notify Cube.
     * @deprecated Use Create() directly please
     */
    static MUC(publicKey: Buffer,
               privateKey: Buffer,
               options: CubeCreateOptions = {},
    ): Cube {
        options.cubeType = CubeType.MUC;
        options.publicKey = publicKey;
        options.privateKey = privateKey;
        return this.Create(options);
    }

    /**
     * Create a Persistant Immutable Cube, which is a type of smart cube used
     * for data to be made available long-term.
     * @deprecated Use Create() directly please
     */
    static PIC(options: CubeCreateOptions = {}): Cube {
        options.cubeType = CubeType.PIC;
        return this.Create(options);
    }

    declare protected _fields: CubeFields;

    /** @deprecated Use methods defined in Veritable instead */
    public get fields(): CubeFields {
        // TODO: This is very dangerous as obviously accessing the raw fields
        // could manipulate the Cube. Maybe make CubeFields an
        // EventEmitter and mark the Cube manipulated on change events?
        return this._fields;
    }
    manipulateFields(): CubeFields {
        this.cubeManipulated();
        return this._fields;
    }

    private binaryData: Buffer = undefined;

    private picKey: CubeKey = undefined;  // only used for PICs
    private hash: Buffer = undefined;

    private _privateKey: Buffer = undefined;
    get privateKey() { return this._privateKey; }
    set privateKey (privateKey: Buffer) { this._privateKey = privateKey; }
    get publicKey() { return this.getFirstField(CubeFieldType.PUBLIC_KEY)?.value; }
    set publicKey(val: Buffer) {
        const field: CubeField = this.getFirstField(CubeFieldType.PUBLIC_KEY);
        if (field === undefined) throw new CubeError("Cannot set public key on a Cube without a PUBLIC_KEY field");
        field.value = val;
    }

    /** Reactivate an existing, binary cube */
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
    /** Copy constructor: Copy an existing Cube */
    constructor(copyFrom: Cube);
    // Repeat implementation as declaration as calls must strictly match a
    // declaration, not the implementation (which is stupid)
    constructor(param1: Buffer | CubeType | Cube, option?: CubeOptions);
    constructor(
            param1: Buffer | CubeType | Cube,
            options?: CubeOptions)
    {
        if (param1 instanceof Cube) {
            // copy constructor
            super(param1);  // superclass will take care of fields and stuff
            // copy binary data
            this.binaryData = param1.binaryData?
                Buffer.from(param1.binaryData) : undefined;
            // copy pic key
            this.picKey = param1.picKey?
                asCubeKey(Buffer.from(param1.picKey)) : undefined;
            // copy hash
            this.hash = param1.hash?
                Buffer.from(param1.hash) : undefined;
            // copy private key
            this._privateKey = param1.privateKey?
                Buffer.from(param1.privateKey) : undefined;
        } else if (Buffer.isBuffer(param1)) {
            // reactivate an existing cube from binary, usually received from the network
            const binaryData = param1;
            if (binaryData.length !== NetConstants.CUBE_SIZE) {
                logger.info(`Cube: Cannot reactivate dormant (binary) Cube of size ${binaryData.length}, must be ${NetConstants.CUBE_SIZE}`);
                throw new BinaryLengthError(`Cannot reactivate dormant (binary) Cube of size ${binaryData.length}, must be ${NetConstants.CUBE_SIZE}`);
            }
            super({...options, cubeType: CubeUtil.typeFromBinary(binaryData)});
            this.binaryData = binaryData;  // maybe TODO: why do we even need to keep the binary buffer after parsing?
            if (!(this.cubeType in CubeType)) {
                logger.info(`Cube: Cannot reactivate dormant (binary) Cube of unknown type ${this.cubeType}`);
                throw new CubeError(`Cannot reactivate dormant (binary) Cube of unknown type ${this.cubeType}`)
            }
            this._fields = this.fieldParser.decompileFields(this.binaryData) as CubeFields;
            if (!this._fields) {
                logger.info(`Cube: Could not decompile dormant (binary) Cube`);
                throw new BinaryDataError("Could not decompile dormant (binary) Cube");
            }
            this.hash = CubeUtil.calculateHash(binaryData);
            if (this.cubeType === CubeType.PIC || this.cubeType === CubeType.PIC_NOTIFY) {
                this.generatePicKey();
            }
            this.validateCube();
        } else if (param1 in CubeType) {
            // sculpt new Cube
            super({...options, cubeType: param1});
            if (options?.fields) {  // do we have a field set already?
                if (!(options.fields instanceof CubeFields)) {
                    options.fields =  // upgrade to CubeFields if necessary
                        new this.fieldParser.fieldDef.fieldsObjectClass(
                            options.fields,
                            this.fieldParser.fieldDef
                        );
                }
                this.setFields(options.fields as CubeFields);  // set fields
            }  // no fields yet? let's just start out with an empty set then
            else this._fields = new this.fieldParser.fieldDef.fieldsObjectClass([], this.fieldParser.fieldDef);
        } else {
            throw new ApiMisuseError("Cube constructor: first parameter must be Buffer or CubeType");
        }
    }

    toString(): string {
        let ret = "";
        switch (this.cubeType) {
            case CubeType.FROZEN:
                ret = "Frozen Cube";
                break;
            case CubeType.FROZEN_NOTIFY:
                ret = "Frozen Notification Cube";
                break;
            case CubeType.MUC:
                ret = "MUC";
                break;
            case CubeType.MUC_NOTIFY:
                ret = "Notification MUC";
                break;
            case CubeType.PIC:
                ret = "PIC";
                break;
            case CubeType.PIC_NOTIFY:
                ret = "Notification PIC";
                break;
            case CubeType.PMUC:
                ret = "PMUC";
                break;
            case CubeType.PMUC_NOTIFY:
                ret = "Notification PMUC";
                break;
            default:
                ret = "Invalid or unknown type of Cube";
                break;
        }
        ret += ` containing ${this._fields.toString()}`;
        return ret;
    }
    toLongString(): string {
        return this.toString() + '\n' + this._fields.fieldsToLongString();
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
            difficulty: CubeUtil.countTrailingZeroBits(this.hash),
            family: family,
        });
    }

    public setDate(date: number): void {
        this.cubeManipulated();
        const dateField: CubeField =
            this.getFirstField(CubeFieldType.DATE);
        dateField.value.fill(0);
        dateField.value.writeUIntBE(date,  0, NetConstants.TIMESTAMP_SIZE);
    }

    public setFields(fieldsInput: CubeFields | CubeField): void {
        let fields: CubeFields;
        if (fieldsInput instanceof CubeFields) fields = fieldsInput;
        else if (fieldsInput instanceof CubeField) fields = new CubeFields(fieldsInput, this.fieldParser.fieldDef);
        else throw TypeError("Invalid fields type");

        if (Settings.RUNTIME_ASSERTIONS) { // TODO: Double-check that it's okay to make these checks optional, i.e. they are not required for input sanitization
            // verify all fields together are less than 1024 bytes
            const totalLength = fields.getByteLength();
            if (totalLength > NetConstants.CUBE_SIZE) {
                throw new FieldSizeError(`Cube.setFields(): Can't set fields with a total length of ${totalLength} as Cube size is ${NetConstants.CUBE_SIZE}`);
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

    bytesRemaining(max: number = NetConstants.CUBE_SIZE): number {
        return this._fields.bytesRemaining(max);
    }

    // Note: Arguably, it might have been a better idea to make key generation
    // explicit rather than having getKey() async. But it's what we did and it's
    // pretty stable by now.
    public async getKey(): Promise<CubeKey> {
        if (HasSignature[this.cubeType]) {
            // for signed Cubes, the key is the public key
            return asCubeKey(this.publicKey);
        } else if (this.cubeType === CubeType.FROZEN ||
                   this.cubeType === CubeType.FROZEN_NOTIFY) {
            // for frozen Cubes, the key is the whole hash
            return asCubeKey(await this.getHash());
        } else if (this.cubeType === CubeType.PIC ||
                   this.cubeType === CubeType.PIC_NOTIFY) {
            // for PICs, the key is the hash excluding the NONCE and DATE fields
            if (this.picKey === undefined) {
                // PIC key has not been generated yet, do we need to run a
                // full compilation or is it just the PIC key that's missing?
                if (this.binaryData === undefined) await this.compile();
                else this.generatePicKey();
            }
            return this.picKey;
        } else {
            throw new CubeError("CubeType " + this.cubeType + " not implemented");
        }
    }
    public async getKeyString(): Promise<string> {
        return (await this.getKey()).toString('hex');
    }

    public getKeyIfAvailable(): CubeKey {
        if (HasSignature[this.cubeType]) {
            // for signed Cubes, the key is the public key
            return asCubeKey(this.publicKey);
        } else if (this.cubeType === CubeType.FROZEN ||
                   this.cubeType === CubeType.FROZEN_NOTIFY) {
            // for frozen Cubes, the key is the whole hash
            return asCubeKey(this.getHashIfAvailable());
        } else if (this.cubeType === CubeType.PIC ||
                   this.cubeType === CubeType.PIC_NOTIFY) {
            // For PICs, the key is the hash excluding the NONCE and DATE fields.
            return this.picKey;
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
     * It will also sign the Cube if this Cube is of a signature-bearing type.
     * Can either be called explicitly or will be called automatically when
     * you call getBinaryData() or getHash().
     **/
    public async compile(): Promise<void> {
        // Pre-processing:
        // pre-compile sanity checks
        if (Settings.RUNTIME_ASSERTIONS) {
            const expectedPublicKeyLength = sodium.crypto_sign_PUBLICKEYBYTES;
            const expectedPrivateKeyLength = sodium.crypto_sign_SECRETKEYBYTES;
            if (HasSignature[this.cubeType] && (
                this.publicKey?.length !== expectedPublicKeyLength ||
                this.privateKey?.length !== expectedPrivateKeyLength
            )) {
                throw new SmartCubeError(`Cube.compile(): Cannot compile a ${CubeType[this.cubeType]} without a valid public and private key`);
            }
        }

        // Compile it!
        this.binaryData = this.fieldParser.compileFields(this._fields);

        // Post-processing:
        // post-compile sanity checks
        if (Settings.RUNTIME_ASSERTIONS && this.binaryData.length !== NetConstants.CUBE_SIZE) {
            throw new BinaryDataError("Cube: Something went horribly wrong, I just wrote a cube of invalid size " + this.binaryData.length);
        }
        // re-set our fields so they share the same memory as our binary data again
        for (const field of this._fields.all) {
            const offset =
                field.start + this.fieldParser.getFieldHeaderLength(field.type);
            field.value = this.binaryData.subarray(offset, offset + field.length);
        }
        this.signBinaryData();  // sign this Cube if applicable
        await this.generateCubeHash();
        // If this is a PIC, also calculate the PIC key
        if (this.cubeType === CubeType.PIC || this.cubeType === CubeType.PIC_NOTIFY) {
            this.generatePicKey();
        }
        if (Settings.RUNTIME_ASSERTIONS) {
            this.validateCube();
        }
    }

    verifySignature(): boolean {
        const signature: CubeField = this._fields.getFirst(CubeFieldType.SIGNATURE);
        const publicKey: CubeField = this._fields.getFirst(CubeFieldType.PUBLIC_KEY);
        if (signature === undefined || publicKey === undefined) {
            logger.trace(`Cube.veritySignature() called on Cube without SIGNATURE and/or PUBLIC_KEY field; returning false.`)
            return false;
        }
        if (this.binaryData === undefined) {
            logger.trace(`Cube.veritySignature() called on Cube that has not yet been compiled; returning false.`)
            return false;
        }

        // Slice out data to be verified
        // (start of Cube until just before the signature field)
        const dataToVerify = this.binaryData.subarray(0, signature.start);
        const validity: boolean = CubeUtil.verifySignature(
            signature.value, dataToVerify, publicKey.value);
        return validity;
    }

    private validateCube(): void {
        if (HasSignature[this.cubeType]) {
            if (!this.verifySignature()) {
                logger.error('Cube: Invalid signature');
                throw new CubeSignatureError('Cube: Invalid signature');
            }
        }
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
            await this.compile();
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

    private generatePicKey(): void {
        if (this.cubeType !== CubeType.PIC && this.cubeType !== CubeType.PIC_NOTIFY) {
            logger.error("Cube: generatePicKey called on non-PIC cube, doing nothing");
            return;
        };
        if (this.binaryData === undefined) {
            logger.error("Cube: generatePicKey called on undefined binary data");
            throw new BinaryDataError("Cube: generatePicKey called on undefined binary data");
        }
        const keyHashLength = CubeFieldLength[CubeFieldType.TYPE] +
            CubeFieldLength[CubeFieldType.PIC_RAWCONTENT];  // equal to the lengths of PIC_NOTIFY_RAWCONTENT plus NOTIFY
        const keyHashableBinaryData = this.binaryData.subarray(0, keyHashLength);
        this.picKey = asCubeKey(CubeUtil.calculateHash(keyHashableBinaryData));
    }

    /**
     * Signs this Cube if it has a SIGNATURE field.
     * Can safely be called for non-smart cubes, in which case it will simply
     * do nothing due to the lack of a SIGNATURE field.
     */
    private signBinaryData(): void {
        const signature: CubeField = this.getFirstField(CubeFieldType.SIGNATURE);
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
    // Non-worker version for browser portability
    async findValidHash(nonceField: CubeField, abortSignal?: AbortSignal): Promise<Buffer> {
        let nonce: number = 0;
        let hash: Buffer;

        const checkAbort = () => {
            if (abortSignal?.aborted) {
                throw new Error('findValidHash() aborted');
            }
        };

        while (true) {
            if (this.binaryData === undefined) {
                throw new BinaryDataError("findValidHash() Binary data not initialized");
            }
            checkAbort();  // Check for abort signal before starting the hash checking

            // Check 1000 hashes before yielding control back to the event loop
            for (let i = 0; i < 1000; i++) {
                // Write the nonce to binaryData
                nonceField.value.writeUIntBE(nonce, 0, NetConstants.NONCE_SIZE);
                // Calculate the hash
                hash = CubeUtil.calculateHash(this.binaryData);
                // Check if the hash is valid
                if (CubeUtil.countTrailingZeroBits(hash) >= this.requiredDifficulty) {
                    return hash;  // Found valid hash, return it
                }
                nonce++;
            }
            checkAbort();  // Check for abort signal before yielding

            // Yield to the event loop to avoid blocking
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    getDifficulty(): number {
        if (this.binaryData === undefined || this.hash === undefined) {
            this.compile();  // BUGBUG: this does not work, needs await, thus whole method needs to be async
        }
        return CubeUtil.countTrailingZeroBits(this.hash);
    }

}

// Note: Never move the family definitions to another file as they must be
// executed strictly after the Cube implementation.
// You may get random uncaught ReferenceErrors otherwise.
export const coreCubeFamily: CubeFamilyDefinition = {
    cubeClass: Cube,
    parsers: CoreFieldParsers,
}
