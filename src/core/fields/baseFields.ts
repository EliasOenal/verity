import { FieldDefinition, FieldParser } from './fieldParser';
import { ApiMisuseError } from '../settings';
import { BaseField } from './baseField';

import { Buffer } from 'buffer';
import { logger } from '../logger';
import { isIterableButNotBuffer } from '../helpers/misc';

export enum FieldPosition {
    FRONT,
    AFTER_FRONT_POSITIONALS,
    BEFORE_BACK_POSITIONALS,
    BACK
}

/**
 * Metric to apply when comparing two fields using equals():
 *   - IgnoreOrder will compare two fieldsets as equal if they have the same
 *     fields with the same content, even if they are in a different order.
 *   - Ordered will compare two fieldsets as equal if they have the same
 *     order, even if they do not have the same start offset.
 *     This is the default behaviour as it allows to compare compiled and
 *     uncompiled fieldsets.
 *   - OrderedSameOffset will compare two fieldsets as equal if they have the
 *     same order and the same start offset.
 */
export enum FieldEqualityMetric {
    IgnoreOrder,
    Ordered,
    OrderedSameOffset,
}

export interface FieldsEqualOptions {
    metric?: FieldEqualityMetric;
    ignoreDisregarded?: boolean;
}

/** Nice wrapper around a field array providing some useful methods. */
// TODO: Abstract this further by introducing a base class not requiring a field
// definition. Within BaseFields, the field definition is currently *only* used in getByteLength()
// and in the insert before/after positionals methods.
export class BaseFields {  // cannot make abstract, FieldParser creates temporary BaseField objects
    static NormaliseFields<T extends typeof BaseFields>(
            this: T,
            fields: BaseField | BaseField[] | BaseFields | InstanceType<T> | undefined,
            fieldDefinition: FieldDefinition,
    ): InstanceType<T> {
        if (fields instanceof this) return fields as InstanceType<T>;
        else if (fields instanceof BaseField) {
            return new fieldDefinition.fieldsObjectClass([fields], fieldDefinition);
        }
        else if (Array.isArray(fields)) {
            return new fieldDefinition.fieldsObjectClass(fields, fieldDefinition);
        }
        else return new fieldDefinition.fieldsObjectClass([], fieldDefinition);
    }

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
    static DefaultPositionals<T extends typeof BaseFields>(
            this: T,
            fieldDefinition: FieldDefinition,
            data?: BaseFields | BaseField[] | BaseField,
    ): InstanceType<T> {
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

        return fields as InstanceType<T>;
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
            // copy-construct fields
            this.data = [];
            for (const field of data.data) {
                const fieldType = field.constructor as typeof BaseField;
                this.data.push(new fieldType(field));
            }
            // copy field definition
            if (data.fieldDefinition) this.fieldDefinition = {...data.fieldDefinition};
            else if (fieldDefinition) this.fieldDefinition = {...fieldDefinition};
            else throw new ApiMisuseError("BaseFields constructor: Cannot copy-construct Fields object without a field definition");
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

    equals(
            other: BaseFields,
            options: FieldsEqualOptions = {},
    ): boolean {
        // set default options
        options.metric ??= FieldEqualityMetric.IgnoreOrder;
        options.ignoreDisregarded ??= true;

        let cmpThis: BaseFields, cmpOther: BaseFields;
        if (options.ignoreDisregarded) {
            cmpThis = this.withoutDisregarded();
            cmpOther = other.withoutDisregarded();
        } else {
            cmpThis = this;
            cmpOther = other;
        }

        switch (options.metric) {
            case FieldEqualityMetric.IgnoreOrder:
                return cmpThis.equalsUnordered(cmpOther);
            case FieldEqualityMetric.Ordered:
                return cmpThis.equalsOrdered(cmpOther);
            case FieldEqualityMetric.OrderedSameOffset:
                return cmpThis.equalsOrdered(cmpOther, true);
        }
    }

    equalsOrdered(other: BaseFields, compareOffsets: boolean = false): boolean {
        if (this.length != other.length) {
            return false;
        }
        for (let i=0; i<this.length; i++) {
            if (!this.all[i].equals(other.all[i], compareOffsets)) {
                return false;
            }
        }
        return true;
    }

    equalsUnordered(other: BaseFields): boolean {
        if (this.length != other.length) {
            return false;
        }
        // compare each of my field...
        for (let i=0; i<this.length; i++) {
            // ... trying to find an equal field in other
            let fieldEqual = false;
            for (let j=0; j<other.length; j++) {
                if (this.all[i].equals(other.all[j])) {
                    fieldEqual = true;
                    break;
                }
            }
            if (!fieldEqual) {
                return false;
            }
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
        if (type && !(Array.isArray(type))) type = [type];

        if (type) {  // any actual filtering requested?
            const ret = [];
            for (const field of fields) {
                if ((type as Array<number>).includes(field.type)) ret.push(field);
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

    public appendField(...fields: BaseField[]): void {
        this.data.push(...fields);
    }

    public insertFieldInFront(...fields: BaseField[]): void {
        this.data.unshift(...fields);
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
            position: FieldPosition = FieldPosition.BEFORE_BACK_POSITIONALS,
            ...fields: BaseField[]
    ): void {
        if (position === FieldPosition.FRONT) {
            this.insertFieldInFront(...fields);
        } else if (position === FieldPosition.AFTER_FRONT_POSITIONALS) {
            this.insertFieldAfterFrontPositionals(...fields);
        } else if (position === FieldPosition.BEFORE_BACK_POSITIONALS) {
            this.insertFieldBeforeBackPositionals(...fields);
        } else if (position === FieldPosition.BACK) {
            this.appendField(...fields);
        } else {
            throw new ApiMisuseError(`BaseFields.inserField: Invalid position value ${position}`);
        }
    }

    /**
     *  Will insert your field after all front positional fields as defined by
     *  this.fieldDefinition.
     *  Will insert at the very front if there are no front positionals.
     */
    public insertFieldAfterFrontPositionals(...fields: BaseField[]): void {
        for (let i = 0; i < this.data.length; i++) {
            if (!Object.values(this.fieldDefinition.positionalFront).includes(this.data[i].type)) {
                this.data.splice(i, 0, ...fields);
                return;
            }
        }
        // apparently, our field set is either empty or consists entirely of front positionals
        this.insertFieldInFront(...fields);
    }

    /**
     *  Will insert your field before all back positional fields as defined by
     *  this.fieldDefinition.
     *  Will insert at the very back if there are no back positionals.
     */
    public insertFieldBeforeBackPositionals(...fields: BaseField[]): void {
        for (let i = 1; i <= this.data.length; i++) {
            const iType = this.data[this.data.length-i].type;
            if (!Object.values(this.fieldDefinition.positionalBack).includes(iType)) {
                this.data.splice(this.data.length-i+1, 0, ...fields);
                return;
            }
        }
        // apparently, our field set is either empty or consists entirely of back positionals
        this.appendField(...fields);
    }

    /**
     * Inserts a new field before the *first* existing field of the
     * specified type, or at the very end if no such field exists.
     */
    public insertFieldBefore(type: number, ...fields: BaseField[]): void {  // in top-level fields, type must be one of FieldType as defined in cubeDefinitions.ts
        for (let i = 0; i < this.data.length; i++) {
            if (this.data[i].type == type) {
                this.data.splice(i, 0, ...fields)
                return;
            }
        }
        // no such field
        this.appendField(...fields);
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


    /**
     * @returns A copy of this field set, with all disregarded fields removed.
     *   Disregarded fields are those that appear after a stop field (as defined
     *   by this.fieldDefinition) and are not positional,
     *   as well as the remainder field.
     *   (Note that the stop field itself however is not a disregarded field.)
     *   For example:
     *     - In the core Cube family, there are no disregarded fields.
     *       The returned field set will be identical to this one.
     *     - In the CCI family, all non-positional fields after CCI_END will be
     *       disregarded, as will be REMAINDER.
     */
    withoutDisregarded(): this {
        // make a shallow copy of this field set
        const copy = Object.assign(Object.create(Object.getPrototypeOf(this)), this);
        copy.data = [];

        // Prepare a list of positional field types
        const positionals: number[] = [
            ...Object.values(this.fieldDefinition.positionalFront),
            ...Object.values(this.fieldDefinition.positionalBack),
        ];
        // Prepare a helper function to check for the stop and remainder fields
        const isStop = type =>
            Number.isInteger(this.fieldDefinition.stopField) &&
            type === this.fieldDefinition.stopField;
        const isRemainder = type =>
            Number.isInteger(this.fieldDefinition.remainderField) &&
            type === this.fieldDefinition.remainderField;

        // look for disregarded fields and remove them
        let stop: boolean = false;
        for (let i = 0; i < this.data.length; i++) {
            // Is this a positional field?
            if (positionals.includes(this.data[i].type)) {
                // positionals are never disregarded
                copy.data.push(this.data[i]);
                // handle special case: positional field could be the stop field
                if (isStop(this.data[i].type)) {
                    stop = true;
                }
            }

            // Are we still before the stop field?
            else if (!stop) {
                // Did we encounter the stop field?
                // (first check if there even is a stop field)
                if (isStop(this.data[i].type)) {
                    stop = true;
                    // Note that the stop field itself is *not* disregarded
                    copy.data.push(this.data[i]);
                }
                else if (isRemainder(this.data[i].type)) {
                    // The remainder field is always disregarded
                    // Do nothing
                }
                else {
                    // Regular field before the stop -- keep it
                    copy.data.push(this.data[i]);
                }
            }

            // If we end up here, the encountered field is
            // - not a positional, and
            // - past the stop field.
            // It will thus be disregarded.
        }

        return copy;
    }
}
