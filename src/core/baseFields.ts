import { NetConstants } from './networkDefinitions';
import { CUBE_HEADER_LENGTH, FieldError, WrongFieldType } from './cubeDefinitions';
import { CubeKey } from './cube';
import { logger } from './logger';

import { Buffer } from 'buffer';
import { FieldDefinition, FieldParser } from './fieldParser';

/**
 * A field is a data entry in binary TLV data.
 * This is the abstract base class for fields used on different levels of Verity.
 * In particular, Cubes consist of CubeFields, and CubeField inherits from this class.
 * You should best consider this an abstract base class, although it is not
 * technically abstract.
 */
export class BaseField {
    type: number;  // In top-level fields, type will be one of FieldType (enum in cubeDefinitions.ts). Applications may or may not chose to keep their application-level fields compatible with our top-level numbering.
    length: number;  // TODO remove -- length of field value not including header, which is completely unnecessary as it's always equal to value.length
    value: Buffer;

    /**
     * Start of field as offset from beginning of cube (binaryData).
     * When creating a Cube, this is not know yet. Only when you finalize the
     * cube, i.e. compile it by calling getBinaryData() on it, these will be
     * calculated.
     * We refer to a field as a `full field` once this offset is know and you
     * can check whether a field is full by calling isFull().
     */
    start: number = undefined;

    static Payload(buf: Buffer | string, fieldDefinition: FieldDefinition) {
        if (typeof buf === 'string' || buf instanceof String)  {
            buf = Buffer.from(buf, 'utf-8');
        }
        return new fieldDefinition.fieldObjectClass(
            fieldDefinition.fieldNames["PAYLOAD"], buf.length, buf);
    }

    // Note: We've moved most relationships to the application level
    // (i.e. inside the payload field) and may want to drop the top-level
    // RELATES_TO altogether
    /** @return A Field or Field-subclass object, as defined by param fieldType.
     * By default, a TopLevelField.
     */
    static RelatesTo(rel: BaseRelationship, fieldDefinition: FieldDefinition) {
        const value: Buffer = Buffer.alloc(
            NetConstants.RELATIONSHIP_TYPE_SIZE +
            NetConstants.CUBE_KEY_SIZE);
        value.writeIntBE(rel.type, 0, NetConstants.RELATIONSHIP_TYPE_SIZE);
        rel.remoteKey.copy(
            value,  // target buffer
            NetConstants.RELATIONSHIP_TYPE_SIZE,  // target start position
            0,  // source start
            NetConstants.CUBE_KEY_SIZE  // source end
        );
        return new fieldDefinition.fieldObjectClass(
            fieldDefinition.fieldNames['RELATES_TO'],
            fieldDefinition.fieldLengths[fieldDefinition.fieldNames['RELATES_TO']],
            value);
    }

    constructor(type: number, length: number, value: Buffer, start?: number) {
        if (length === undefined) {
            throw new FieldError("Field length must be defined");
        }
        this.type = type;
        this.length = length;
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
    public isFinalized() {
        if (this.start !== undefined) return true;
        else return false;
    }
}


/**
 * Base class for relationships (usually between Cubes) on different levels
 * of Verity. In the core lib, we subclass this as CubeRelationship (see cubeFields.ts).
 * Applications may or may not subclass and reuse this for application-layer fields.
 * If they wish to do so, they must either re-use top-level field definitions or
 * creates their own, compatible `RELATES_TO` field type and also call it `RELATES TO`.
 * (tl;dr: If you deviate too much from top-level cube fields, it's your fault if it breaks.)
 */
export abstract class BaseRelationship {
    type: number;  // In top-level fields, type will be one of FieldType (enum in cubeDefinitions.ts). Application may or may not chose to re-use this relationship system on the application layer, and if they do so they may or may not chose to keep their relationship types compatible with ours.
    remoteKey: CubeKey;

    constructor(type: number = undefined, remoteKey: CubeKey = undefined) {
        this.type = type;
        this.remoteKey = remoteKey;
    }

    static fromField(field: BaseField, fieldDefinition: FieldDefinition): BaseRelationship {
        const relationship = new fieldDefinition.fieldObjectClass.relationshipType();
        if (field.type != fieldDefinition.fieldNames['RELATES_TO']) {
            throw (new WrongFieldType(
                "Can only construct relationship object from RELATES_TO field, " +
                "got " + field.type + "."));
        }
        relationship.type = field.value.readIntBE(0, NetConstants.RELATIONSHIP_TYPE_SIZE);
        relationship.remoteKey = field.value.subarray(
            NetConstants.RELATIONSHIP_TYPE_SIZE,
            NetConstants.RELATIONSHIP_TYPE_SIZE + NetConstants.CUBE_KEY_SIZE);
        return relationship;
    }
}


/** Nice wrapper around a field array providing some useful methods. */
export class BaseFields {  // cannot make abstract, FieldParser creates temporary BaseField objects
    fieldDefinition: FieldDefinition = undefined;
    private data: Array<BaseField> = undefined;

    constructor(
            data: Array<BaseField> | BaseField | undefined,
            fieldDefinition: FieldDefinition) {
        this.fieldDefinition = fieldDefinition;
        if (data) {
            if (data instanceof Array) this.data = data;
            else this.data = [data];
        }
        else this.data = [];
    }

    equals(other: BaseFields, compareLocation: boolean = false) {
        if (this.getFieldCount() != other.getFieldCount()) return false;
        for (let i=0; i<this.getFieldCount(); i++) {
            if (!this.all()[i].equals(other.all()[i], compareLocation)) return false;
        }
        return true;
    }

    getByteLength() {
        let length = 0;
        for (const field of this.data) {
            length += FieldParser.getFieldHeaderLength(field.type, this.fieldDefinition);
            length += field.length;
        }
        return length;
    }

    getFieldCount() {
        return this.data.length;
    }

    public all(): Array<BaseField> {
        return this.data;
    }

    /**
    * Gets all fields of a specified type
    * @param type Which type of field to get
    * @return An array of Field objects, which may be empty.
    */
    public getFieldsByType(type: number): Array<BaseField> {  // in top-level fields, type must be one of FieldType as defined in cubeDefinitions.ts
        const ret = [];
        for (const field of this.data) {
            if (field.type == type) ret.push(field);
        }
        return ret;
    }

    public getFirstField(type: Number): BaseField {
        for (const field of this.data) {
            if (field.type == type) return field;
        }
        return undefined;  // none found
    }

    public appendField(field: BaseField) {
        this.data.push(field);
    }

    public insertFieldInFront(field: BaseField) {
        this.data.unshift(field);
    }

    /// @ method Inserts a new field before the *first* existing field of the
    ///          specified type, or at the very end if no such field exists.
    ///          (This is used, in particular, by Cube.setFields() to determine
    ///          if any auto-padding needs to be inserted before a signature.)
    public insertFieldBefore(type: number, field: BaseField) {  // in top-level fields, type must be one of FieldType as defined in cubeDefinitions.ts
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
    * Gets the relationships this cube has to other cubes, if any.
    * @param [type] If specified, only get relationships of the specified type.
    * @return An array of Relationship objects, which may be empty.
    */
    public getRelationships(type?: number): Array<BaseRelationship> {
        const relationshipfields = this.getFieldsByType(
            this.fieldDefinition.fieldNames['RELATES_TO'] as number);
            // "as number" required as enums are two-way lookup tables
        const ret = [];
        for (const relationshipfield of relationshipfields) {
            const relationship: BaseRelationship =
                BaseRelationship.fromField(relationshipfield, this.fieldDefinition);
            if (!type || relationship.type == type) ret.push(relationship);
        }
        return ret;
    }
    public getFirstRelationship(type?: number): BaseRelationship {
        const rels: Array<BaseRelationship> = this.getRelationships(type);
        if (rels.length) return rels[0];
        else return undefined;
    }
}
