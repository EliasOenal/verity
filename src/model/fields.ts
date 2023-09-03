import { Buffer } from 'buffer';
import { logger } from './logger';
import { CubeKey, WrongFieldType } from './cube';
import { NetConstants } from './networkDefinitions';

/**
 * Top-level field definitions.
 * These are used for the FieldParser in the core library.
 * Applications will usually supplement this with their own sub-field structure
 * within the top-level payload field; for this, they can re-use our FieldParser
 * by supplying it with their own field structure data.
 */
export enum FieldType {
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

export const FIELD_LENGTHS: { [key: number]: number | undefined } = {
    [FieldType.PAYLOAD]: undefined,
    [FieldType.RELATES_TO]: NetConstants.RELATIONSHIP_TYPE_SIZE + NetConstants.CUBE_KEY_SIZE,
    [FieldType.PADDING_NONCE]: undefined,
    [FieldType.KEY_DISTRIBUTION]: 40,
    [FieldType.SHARED_KEY]: 32,
    [FieldType.ENCRYPTED]: undefined,
    [FieldType.TYPE_SIGNATURE]: 72,
    [FieldType.TYPE_SMART_CUBE]: 0, // Just a single header byte
    [FieldType.TYPE_PUBLIC_KEY]: 32,
};

export enum CubeType {
    CUBE_TYPE_REGULAR = 0xFF,
    CUBE_TYPE_MUC = 0x00,
    CUBE_TYPE_IPC = 0x01,
    CUBE_TYPE_RESERVED = 0x02,
    CUBE_TYPE_RESERVED2 = 0x03,
}

export enum RelationshipType {
    CONTINUED_IN = 1,
    MENTION = 2,
    REPLY_TO = 3,
    QUOTATION = 4,
    OWNS = 5,
}

export class Field {
    type: FieldType;
    length: number;
    value: Buffer;

    // Start of field as offset from beginning of cube (binaryData)
    start: number = undefined;

    constructor(type: FieldType, length: number, value: Buffer, start?: number) {
        this.type = type;
        this.length = length;
        this.value = value;
        this.start = start;
    }

    public isFull() { if (this.start) return true; else return false; }

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

export class Relationship {
    type: RelationshipType;
    remoteKey: CubeKey;

    constructor(type: RelationshipType = undefined, remoteKey: CubeKey = undefined) {
        this.type = type;
        this.remoteKey = remoteKey;
    }

    static fromField(field?: Field) {
        const relationship = new Relationship();
        if (field.type != FieldType.RELATES_TO) {
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

export class Fields {  // TODO: subclass stuff that's specific to top-level fields
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
    public getFieldsByType(type: FieldType): Array<Field> {
        const ret = [];
        for (let i = 0; i < this.data.length; i++) {
            if (this.data[i].type == type) ret.push(this.data[i]);
        }
        return ret;
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

    /// @ method Inserts a new field before the *first* existing field of the
    ///          specified type, or at the very end if no such field exists.
    ///          (This is used, in particular, by Cube.setFields() to determine
    ///          if any auto-padding needs to be inserted before a signature.)
    public insertFieldBefore(type: FieldType, field: Field) {
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
