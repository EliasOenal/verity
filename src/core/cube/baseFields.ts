import { NetConstants } from '../networking/networkDefinitions';
import { CubeKey, FieldError, WrongFieldType } from './cubeDefinitions';
import { logger } from '../logger';

import { Buffer } from 'buffer';
import { FieldDefinition, FieldParser } from '../fieldParser';
import { ApiMisuseError } from '../settings';

/**
 * A field is a data entry in binary TLV data.
 * This is the abstract base class for fields used on different levels of Verity.
 * In particular, Cubes consist of CubeFields, and CubeField inherits from this class.
 * You should best consider this an abstract base class, although it is not
 * technically abstract.
 */
export class BaseField {
    type: number;  // In top-level fields, type will be one of FieldType (enum in cubeDefinitions.ts). Applications may or may not chose to keep their application-level fields compatible with our top-level numbering.
    value: Buffer;
    get length(): number { return this.value?.length; }

    /**
     * Start of field as offset from beginning of cube (binaryData).
     * When creating a Cube, this is not know yet. Only when you finalize the
     * cube, i.e. compile it by calling getBinaryData() on it, these will be
     * calculated.
     * We refer to a field as a `full field` once this offset is know and you
     * can check whether a field is full by calling isFull().
     */
    start: number = undefined;

    constructor(type: number, value: Buffer, start?: number) {
        this.type = type;
        this.value = value;
        this.start = start;
    }

    equals(other: BaseField, compareLocation: boolean = false) {
        if (this.type != other.type) return false;
        if (!this.value.equals(other.value)) return false;
        if (compareLocation && this.start != other.start) return false;
        return true;
    }

    /**
     * Is this a finalized field, i.e. is it's start index within the compiled
     * binary data known yet?
     */
    isFinalized() {
        if (this.start !== undefined) return true;
        else return false;
    }

    toString(valEnc: BufferEncoding = 'hex'): string {
        return `Field type ${this.type}, value ${this.value.toString(valEnc)}`
    }
}


/** Nice wrapper around a field array providing some useful methods. */
export class BaseFields {  // cannot make abstract, FieldParser creates temporary BaseField objects
    fieldDefinition: FieldDefinition = undefined;
    private data: Array<BaseField> = undefined;
    get all() { return this.data }

    constructor(
            data: BaseFields | Array<BaseField> | BaseField | undefined,
            fieldDefinition?: FieldDefinition) {
        if (data instanceof BaseFields) {  // copy constructor
            this.data = data.data;
            this.fieldDefinition = data.fieldDefinition ?? fieldDefinition;
        } else {
            if (fieldDefinition === undefined) throw new ApiMisuseError("BaseFields constructor: Cannot create Fields object without a field definition");
            this.fieldDefinition = fieldDefinition;
            if (data instanceof BaseField) this.data = [data];
            else if (data instanceof Array) this.data = data;
            else this.data = [];
        }
    }

    toString() {
        return `${this.data.length} fields`;
    }
    fieldsToLongString(): string {
        let ret = "";
        for (const field of this.data) ret = ret + field.toString() + '\n';
        return ret;
    }
    toLongString() {
        let ret: string = this.toString() + '\n';
        ret += this.fieldsToLongString();
        return ret;
    }

    equals(other: BaseFields, compareLocation: boolean = false): boolean {
        if (this.count() != other.count()) return false;
        for (let i=0; i<this.count(); i++) {
            if (!this.all[i].equals(other.all[i], compareLocation)) return false;
        }
        return true;
    }

    /** @returns The binary size this fieldset will be once compiled,
     * i.e. including any TLV field headers.
     */
    getByteLength(): number {
        let length = 0;
        for (const field of this.data) {
            length += FieldParser.getFieldHeaderLength(field.type, this.fieldDefinition);
            length += field.value.length;
        }
        return length;
    }

    count(): number {
        return this.data.length;
    }

    /**
    * Gets all fields of a specified type, or all fields
    * @param type Which type of field to get
    * @return An array of Field objects, which may be empty.
    */
    public get(type: number = undefined): Array<BaseField> {  // in top-level fields, type must be one of FieldType as defined in cubeDefinitions.ts
        if (type) {
            const ret = [];
            for (const field of this.data) {
                if (field.type === type) ret.push(field);
            }
            return ret;
        }
        else return this.data;
    }

    /** Gets the first field of a specified type */
    public getFirst(type: Number): BaseField {
        for (const field of this.data) {
            if (field.type === type) return field;
        }
        return undefined;  // none found
    }

    public appendField(field: BaseField): void {
        this.data.push(field);
    }

    public insertFieldInFront(field: BaseField): void {
        this.data.unshift(field);
    }

    /**
     *  Will insert your field after all front positional fields as defined by
     *  this.fieldDefinition.
     *  Will insert at the very front if there are no front positionals.
     */
    public insertFieldAfterFrontPositionals(field: BaseField): void {
        for (let i = 0; i < this.data.length; i++) {
            if (!Object.values(this.fieldDefinition.positionalFront).includes(this.data[i].type)) {
                this.data.splice(i, 0, field);
                return;
            }
        }
        // apparently, our field set is either empty or consists entirely of front positionals
        this.insertFieldInFront(field);
    }

    /**
     *  Will insert your field before all back positional fields as defined by
     *  this.fieldDefinition.
     *  Will insert at the very back if there are no back positionals.
     */
    public insertFieldBeforeBackPositionals(field: BaseField): void {
        for (let i = 1; i <= this.data.length; i++) {
            const iType = this.data[this.data.length-i].type;
            if (!Object.values(this.fieldDefinition.positionalBack).includes(iType)) {
                this.data.splice(this.data.length-i+1, 0, field);
                return;
            }
        }
        // apparently, our field set is either empty or consists entirely of back positionals
        this.appendField(field);
    }

    /**
     * Inserts a new field before the *first* existing field of the
     * specified type, or at the very end if no such field exists.
     * (This is used, in particular, by Cube.setFields() to determine
     * if any auto-padding needs to be inserted before a signature.)
     */
    public insertFieldBefore(type: number, field: BaseField): void {  // in top-level fields, type must be one of FieldType as defined in cubeDefinitions.ts
        for (let i = 0; i < this.data.length; i++) {
            if (this.data[i].type == type) {
                this.data.splice(i, 0, field)
                return;
            }
        }
        // no such field
        this.appendField(field);
    }
}
