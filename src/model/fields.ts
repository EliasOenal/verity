import { NetConstants } from './networkDefinitions';
import { CUBE_HEADER_LENGTH, WrongFieldType } from './cubeDefinitions';
import { CubeKey } from './cube';
import { logger } from './logger';

import { Buffer } from 'buffer';
import { FieldParser } from './fieldParser';

/**
 * Top-level field definitions.
 * These are used for the FieldParser in the core library.
 * Applications will usually supplement this with their own sub-field structure
 * within the top-level payload field; for this, they can re-use our FieldParser
 * by supplying it with their own field structure data.
 */
export enum CubeFieldType {
    PADDING_NONCE = 0x00 << 2,
    PAYLOAD = 0x01 << 2,
    RELATES_TO = 0x02 << 2,
    KEY_DISTRIBUTION = 0x03 << 2,
    SHARED_KEY = 0x04 << 2,
    ENCRYPTED = 0x05 << 2,
    TYPE_SIGNATURE = 0x06 << 2,
    TYPE_SMART_CUBE = 0x07 << 2,
    TYPE_PUBLIC_KEY = 0x08 << 2,
  }

  export const CubeFieldLengths: { [key: number]: number | undefined } = {
    [CubeFieldType.PAYLOAD]: undefined,
    [CubeFieldType.RELATES_TO]: NetConstants.RELATIONSHIP_TYPE_SIZE + NetConstants.CUBE_KEY_SIZE,
    [CubeFieldType.PADDING_NONCE]: undefined,
    [CubeFieldType.KEY_DISTRIBUTION]: 40,  // TODO calculate this based on NetConstants
    [CubeFieldType.SHARED_KEY]: 32,  // TODO calculate this based on NetConstants
    [CubeFieldType.ENCRYPTED]: undefined,
    [CubeFieldType.TYPE_SIGNATURE]: NetConstants.SIGNATURE_SIZE,
    [CubeFieldType.TYPE_SMART_CUBE]: 0, // Just a single header byte
    [CubeFieldType.TYPE_PUBLIC_KEY]: NetConstants.PUBLIC_KEY_SIZE,
  };

  export enum CubeRelationshipType {
    CONTINUED_IN = 1,
    MENTION = 2,
    REPLY_TO = 3,
    QUOTATION = 4,
  }

export interface FieldDefinition {
    fieldNames: object;
    fieldLengths: object;  // maps field IDs to field lenghths, e.g. FIELD_LENGTHS defined in field.ts
    fieldType: any,     // the Field class you'd like to use, e.g. TopLevelField for... you know... top-level fields
    firstFieldOffset: number;
}

export class Field {
    type: number;  // In top-level fields, type will be one of FieldType (enum in cubeDefinitions.ts). Applications may or may not chose to keep their application-level fields compatible with our top-level numbering.
    length: number;
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
        return new fieldDefinition.fieldType(
            fieldDefinition.fieldNames["PAYLOAD"], buf.length, buf);
    }

    // Note: We've moved most relationships to the application level
    // (i.e. inside the payload field) and may want to drop the top-level
    // RELATES_TO altogether
    /** @return A Field or Field-subclass object, as defined by param fieldType.
     * By default, a TopLevelField.
     */
    static RelatesTo(rel: Relationship, fieldDefinition: FieldDefinition) {
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
        return new fieldDefinition.fieldType(
            fieldDefinition.fieldNames['RELATES_TO'],
            fieldDefinition.fieldLengths[fieldDefinition.fieldNames['RELATES_TO']],
            value);
    }

    constructor(type: number, length: number, value: Buffer, start?: number) {
        this.type = type;
        this.length = length;
        this.value = value;
        this.start = start;
    }

    /**
     * Is this a finalized field, i.e. is it's start index within the compiled
     * binary data known yet?
     */
    public isFinalized() { if (this.start) return true; else return false; }
}

export class CubeField extends Field {
    static RelatesTo(rel: Relationship): CubeField {
        return super.RelatesTo(rel, cubeFieldDefinition);
      }

      static Payload(buf: Buffer | string): CubeField  {
        return super.Payload(buf, cubeFieldDefinition);
      }
}

/**
 * This represents a relationship between two cubes and is the object-representation
 * of a RELATES_TO field.
 * For application-layer fields, this may only be used if the application
 * re-uses top-level field definition or creates their own, compatible
 * `RELATES_TO` field type and also calls it `RELATES TO`.
 * (tl;dr: If you deviate too much from our fields, it's your fault if it breaks.)
 */
export class Relationship {
    type: number;  // In top-level fields, type will be one of FieldType (enum in cubeDefinitions.ts). Application may or may not chose to re-use this relationship system on the application layer, and if they do so they may or may not chose to keep their relationship types compatible with ours.
    remoteKey: CubeKey;

    constructor(type: number = undefined, remoteKey: CubeKey = undefined) {
        this.type = type;
        this.remoteKey = remoteKey;
    }

    static fromField(field: Field, fieldDefinition: FieldDefinition): Relationship {
        const relationship = new Relationship();
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
export class CubeRelationship extends Relationship {
    static fromField(field?: Field): CubeRelationship {
        return super.fromField(field, cubeFieldDefinition);
    }
}


export class Fields {
    fieldDefinition: FieldDefinition = undefined;
    data: Array<Field> = undefined;

    constructor(
            data?: Array<Field> | Field,
            fieldDefinition: FieldDefinition = cubeFieldDefinition) {
        this.fieldDefinition = fieldDefinition;
        if (data) {
            if (data instanceof Array) this.data = data;
            else this.data = [data];
        }
        else this.data = [];
    }

    getLength() {
        let length = 0;
        for (const field of this.data) {
            length += FieldParser.getFieldHeaderLength(field.type, this.fieldDefinition);
            length += field.length;
        }
        return length;
    }

    /**
    * Gets all fields of a specified type
    * @param type Which type of field to get
    * @return An array of Field objects, which may be empty.
    */
    public getFieldsByType(type: number): Array<Field> {  // in top-level fields, type must be one of FieldType as defined in cubeDefinitions.ts
        const ret = [];
        for (let i = 0; i < this.data.length; i++) {
            if (this.data[i].type == type) ret.push(this.data[i]);
        }
        return ret;
    }

    public getFirstField(type: Number): Field {
        for (const field of this.data) {
            if (field.type == type) return field;
        }
        return undefined;  // none found
    }

    /// @ method Inserts a new field before the *first* existing field of the
    ///          specified type, or at the very end if no such field exists.
    ///          (This is used, in particular, by Cube.setFields() to determine
    ///          if any auto-padding needs to be inserted before a signature.)
    public insertFieldBefore(type: number, field: Field) {  // in top-level fields, type must be one of FieldType as defined in cubeDefinitions.ts
        for (let i = 0; i < this.data.length; i++) {
            if (this.data[i].type == type) {
                this.data.splice(i, 0, field)
                return;
            }
        }
        // no such field
        this.data.push(field);
    }

    /**
    * Gets the relationships this cube has to other cubes, if any.
    * @param [type] If specified, only get relationships of the specified type.
    * @return An array of Relationship objects, which may be empty.
    */
    public getRelationships(type: number, fieldDefinition: FieldDefinition): Array<Relationship> {
        const relationshipfields = this.getFieldsByType(fieldDefinition.fieldNames['RELATES_TO']);
        const ret = [];
        for (const relationshipfield of relationshipfields) {
            const relationship: Relationship =
                Relationship.fromField(relationshipfield, fieldDefinition);
            if (!type || relationship.type == type) ret.push(relationship);
        }
        return ret;
    }
    public getFirstRelationship(type: number, fieldDefinition: FieldDefinition): Relationship {
        const rels: Array<Relationship> = this.getRelationships(type, fieldDefinition);
        if (rels.length) return rels[0];
        else return undefined;
    }
}

export class CubeFields extends Fields {
    constructor(data?: Array<CubeField> | CubeField) {
        super(data);
    }

    public getRelationships(type?: number): Relationship[] {
        return super.getRelationships(type, cubeFieldDefinition);
    }
    public getFirstRelationship(type?: number): Relationship {
        return super.getFirstRelationship(type, cubeFieldDefinition);
    }
}

// NOTE: Never move this to another file. This only works if it is defined
// strictly after CubeField.
// Javascript is crazy.
export const cubeFieldDefinition: FieldDefinition = {
    fieldNames: CubeFieldType,
    fieldLengths: CubeFieldLengths,
    fieldType: CubeField,
    firstFieldOffset: CUBE_HEADER_LENGTH,
  }
