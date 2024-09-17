import { FieldDefinition, FieldParser } from './fieldParser';
import { ApiMisuseError } from '../settings';
import { BaseField } from './baseField';

import { Buffer } from 'buffer';
import { logger } from '../logger';

export enum FieldPosition {
    FRONT,
    AFTER_FRONT_POSITIONALS,
    BEFORE_BACK_POSITIONALS,
    BACK
}

/** Nice wrapper around a field array providing some useful methods. */
// TODO: Abstract this further by introducing a base class not requiring a field
// definition. Within BaseFields, the field definition is currently *only* used in getByteLength()
// and in the insert before/after positionals methods.
export class BaseFields {  // cannot make abstract, FieldParser creates temporary BaseField objects
    /**
     * Creates a new field set with all mandatory positional fields filled in.
     * @param fieldDefinition Defines what kinds of fields you want.
     *   The FieldDefinition should not have holes in its positional field
     *   specification.
     * @param data Optionally, your existing field set
     * @returns A new field set enriched with all mandatory positional fields.
     *   If your field definition has holes in its positional field specification,
     *  dummy zero type, zero length fields will be created to fill them.
     */
    static DefaultPositionals(
            fieldDefinition: FieldDefinition,
            data: BaseFields | BaseField[] | BaseField | undefined = undefined,
    ): BaseFields {
        // normalize input
        if (data instanceof BaseField) data = [data];
        if (data instanceof BaseFields) data = data.all;

        // create a new fields instance, preserving user-supplied fields
        // note: this copy is inefficient and often unnecessary, but this Code
        // only runs on Cube sculpting. Cube sculpting happens rarely and is
        // computationally dominated by the hashcash calculation.
        const fields: BaseFields =
            new fieldDefinition.fieldsObjectClass(data, fieldDefinition);

        // ensure the fields object has all required front positionals
        const fieldPositionsFront: number[] =
            Object.keys(fieldDefinition.positionalFront).map(key => Number.parseInt(key));
        for (let i=Math.max(...fieldPositionsFront); i>=1; i--) {
            let type = fieldDefinition.positionalFront[i] ?? 0;
            fields.ensureFieldInFront(type, fieldDefinition);
        }

        // ensure the fields object has all required back positionals
        const fieldPositionsBack: number[] =
            Object.keys(fieldDefinition.positionalBack).map(key => Number.parseInt(key));
        for (let i=Math.max(...fieldPositionsBack); i>=1; i--) {
            let type = fieldDefinition.positionalBack[i] ?? 0;
            fields.ensureFieldInBack(type, fieldDefinition);
        }

        return fields;
    }

    fieldDefinition: FieldDefinition = undefined;
    private data: Array<BaseField> = undefined;
    get all() {
        // maybe TODO: this is unsafe and should be removed
        return this.data;
    }

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

    equals(other: BaseFields, compareOffsets: boolean = false): boolean {
        if (this.length != other.length) return false;
        for (let i=0; i<this.length; i++) {
            if (!this.all[i].equals(other.all[i], compareOffsets)) return false;
        }
        return true;
    }

    /**
     * Calculates the binary size of the supplied fields, or of the whole fieldset
     * if no fields are supplied. Calculated lengths are including any TLV headers.
     * @param fields The fields to calculate the length of
     * @returns The size in bytes
     */
    getByteLength(fields: BaseField | BaseField[] = this.data): number {
        // normalise input
        if (fields instanceof BaseField) fields = [fields];

        let length = 0;
        for (const field of fields) {
            length += FieldParser.getFieldHeaderLength(field.type, this.fieldDefinition);
            length += field.value.length;
        }
        return length;
    }

    get length(): number {
        return this.data.length;
    }

    static get(fields: BaseField | BaseFields | BaseField[], type: number | number[] = undefined): Array<BaseField> {  // in top-level fields, type must be one of FieldType as defined in cubeDefinitions.ts
        // input normalisation
        if (fields instanceof BaseField) fields = [fields];
        if (fields instanceof BaseFields) fields = fields.all;
        if (!(Array.isArray(type))) type = [type];

        if (type) {  // any actual filtering requested?
            const ret = [];
            for (const field of fields) {
                if (type.includes(field.type)) ret.push(field);
            }
            return ret;
        }
        else return fields;  // performance optimisation in case of no filter
    }

    /**
    * Gets all fields of one or more specified types, or all fields
    * @param type Which type(s) of field to get
    * @return An array of Field objects, which may be empty.
    */
    public get(type: number | number[] = undefined): Array<BaseField> {  // in top-level fields, type must be one of FieldType as defined in cubeDefinitions.ts
        return BaseFields.get(this.data, type);
    }

    static getFirst(fields: BaseField | BaseFields | BaseField[], type: Number): BaseField {
        // input normalisation
        if (fields instanceof BaseField) fields = [fields];
        if (fields instanceof BaseFields) fields = fields.all;
        // if input is not iterable (incl undefined), return undefined
        if (!(Symbol.iterator in Object(fields))) return undefined;
        // perform search as requested
        for (const field of fields) {
            if (field.type === type) return field;
        }
        return undefined;  // none found
    }

    /** Gets the first field of a specified type */
    public getFirst(type: Number): BaseField {
        return BaseFields.getFirst(this.data, type);
    }

    /**
     * Splits the list of fields into arrays starting with a field of the
     * specified type.
     * @param [type] The Field type to slice by
     * @param [includeBefore] If the field list does not start with a field of
     * the specified type, this flag determines what to do with the front fields.
     * If true, they will be returned as the first slice.
     * If false, they will not be returned at all.
     */
    public sliceBy(type: Number, includeBefore: boolean = false): this[] {
        const slices: BaseFields[] = [];
        function commitSlice(slice: BaseFields) {
            if (slice.length > 0) {
                if (includeBefore || slice.all[0].type === type) {
                    // but only if it starts with the specified field type
                    // or the caller opted in to getting the leading fields
                    slices.push(slice);
                }
            }
        }
        let currentSlice: BaseFields = new (this.constructor as any)([], this.fieldDefinition);
        for (const field of this.data) {
            if (field.type === type) {
                commitSlice(currentSlice);
                // start new slice
                currentSlice = new (this.constructor as any)([], this.fieldDefinition);
            }
            currentSlice.appendField(field);  // commit field to slice
        }
        commitSlice(currentSlice);
        return slices as this[];
    }

    public appendField(field: BaseField): void {
        this.data.push(field);
    }

    public insertFieldInFront(field: BaseField): void {
        this.data.unshift(field);
    }

    public removeField(index: number): void;
    public removeField(field: BaseField): void;
    public removeField(field: number|BaseField): void;
    public removeField(param: number | BaseField): void {
        let index = undefined;
        // if not called by index, find index
        if (param instanceof BaseField) {
            for (let i=0; i<this.data.length; i++) {
                if (this.data[i] === param) index = i;
            }
        } else {
            index = param;
        }
        if(!(typeof index === 'number')) return;
        // remove field
        this.data.splice(index, 1);
    }

    // maybe TODO: support inserting at arbitrary index
    public insertField(
            field: BaseField,
            position: FieldPosition = FieldPosition.BEFORE_BACK_POSITIONALS,
    ): void {
        if (position === FieldPosition.FRONT) {
            this.insertFieldInFront(field);
        } else if (position === FieldPosition.AFTER_FRONT_POSITIONALS) {
            this.insertFieldAfterFrontPositionals(field);
        } else if (position === FieldPosition.BEFORE_BACK_POSITIONALS) {
            this.insertFieldBeforeBackPositionals(field);
        } else if (position === FieldPosition.BACK) {
            this.appendField(field);
        } else {
            throw new ApiMisuseError(`BaseFields.inserField: Invalid position value ${position}`);
        }
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

    /**
     * Ensures there is a field of the specified type at the very front of this
     * field list. If a field of such type already exists, it is moved to the
     * front. Otherwise, the supplied defaultField will be inserted at the front.
     * @param defaultField - The default field to use if no field of the specified
     *   type exists. You may alternatively define a field definition if this
     *   field definition defines a default field for the specified type.
     */
    public ensureFieldInFront(type: number, defaultField: BaseField | FieldDefinition): void {
        // normalize input
        if (!(defaultField instanceof BaseField)) {
            defaultField = BaseField.DefaultField(defaultField as FieldDefinition, type);
        }

        let field = this.getFirst(type) ?? defaultField;
        if (field === undefined) {
          field = defaultField;
        } else {
          this.removeField(field);
        }
        this.insertFieldInFront(field);
    }

    /**
     * Ensures there is a field of the specified type at the very back of this
     * field list. If a field of such type already exists, it is moved to the
     * back. Otherwise, the supplied defaultField will be inserted at the back.
     */
    public ensureFieldInBack(type: number, defaultField: BaseField | FieldDefinition): void {
        // normalize input
        if (!(defaultField instanceof BaseField)) {
            defaultField = BaseField.DefaultField(defaultField as FieldDefinition, type);
        }

        let field = this.getFirst(type);
        if (field === undefined) {
          field = defaultField;
        } else {
          this.removeField(field);
        }
        this.appendField(field);
    }
}
