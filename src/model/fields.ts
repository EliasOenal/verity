import { Buffer } from 'buffer';
import { logger } from './logger';
import { CubeKey, WrongFieldType } from './cube';
import { NetConstants } from './networkDefinitions';
import { FIELD_LENGTHS, FieldType, RelationshipType } from './cubeDefinitions';

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

    constructor(type: number, length: number, value: Buffer, start?: number) {
        this.type = type;
        this.length = length;
        this.value = value;
        this.start = start;
    }

    /**
     * Is this a full field, i.e. is it's start index within a compiled cube's
     * binary data known yet?
     */
    public isFull() { if (this.start) return true; else return false; }
}

export class TopLevelField extends Field {
    static Payload(buf: Buffer | string): Field {
        if (typeof buf === 'string' || buf instanceof String)  {
            buf = Buffer.from(buf, 'utf-8');
        }
        return new Field(FieldType.PAYLOAD, buf.length, buf);
    }

    static RelatesTo(rel: Relationship): Field {
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
        return new Field(
            FieldType.RELATES_TO,
            FIELD_LENGTHS[FieldType.RELATES_TO],
            value);
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

    static fromField(field?: Field, fieldDefinition = FieldType) {
        const relationship = new Relationship();
        if (field.type != fieldDefinition.RELATES_TO) {
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


export class Fields {
    public data: Array<Field>;

    constructor(data?: Array<Field> | Field) {
        if (data) {
            if (data instanceof Array) this.data = data;
            else this.data = [data];
        }
        else this.data = [];
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
}

export class TopLevelFields extends Fields {
    constructor(data?: Array<TopLevelField> | TopLevelField) {
        super(data);
    }

    /**
    * Gets the relationships this cube has to other cubes, if any.
    * @param [type] If specified, only get relationships of the specified type.
    * @return An array of Relationship objects, which may be empty.
    */
    public getRelationships(type?: RelationshipType): Array<Relationship> {
        const relationshipfields = this.getFieldsByType(FieldType.RELATES_TO);
        const ret = [];
        for (const relationshipfield of relationshipfields) {
            const relationship: Relationship =
                Relationship.fromField(relationshipfield);
            if (!type || relationship.type == type) ret.push(relationship);
        }
        return ret;
    }
    public getFirstRelationship(type?: RelationshipType): Relationship {
        const rels: Array<Relationship> = this.getRelationships(type);
        if (rels.length) return rels[0];
        else return undefined;
    }

}