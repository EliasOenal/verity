import { Buffer } from 'buffer';
import { logger } from './logger';
import { Cube, CUBE_HEADER_LENGTH, InvalidCubeKey, WrongFieldType } from './cube';
import { NetConstants } from './networkDefinitions';

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

export enum SmartCubeType {
    CUBE_TYPE_MUC = 0x00,
    CUBE_TYPE_IPB = 0x01,
    CUBE_TYPE_RESERVED = 0x02,
    CUBE_TYPE_RESERVED2 = 0x03,
}

export enum RelationshipType {
    CONTINUED_IN = 1,
    MENTION = 2,
    REPLY_TO = 3,
    QUOTATION = 4,
}

export interface FullField {
    type: FieldType;
    start: number; // Start of field as offset from beginning of cube (binaryData)
    length: number;
    value: Buffer;
}

export class Field {
    type: FieldType;
    length: number;
    value: Buffer;

    static Payload(buf: Buffer): Field {
        return {
            type: FieldType.PAYLOAD,
            length: buf.length,
            value: buf,
        };
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

        return {
            type: FieldType.RELATES_TO,
            length: FIELD_LENGTHS[FieldType.RELATES_TO],
            value: value
        };
    }
}

export class Relationship {
    type: RelationshipType;
    remoteKey: Buffer;

    constructor(type: RelationshipType = undefined, remoteKey: Buffer = undefined) {
        this.type = type;
        this.remoteKey = remoteKey;
    }

    static fromField(field?: Field) {
        let relationship = new Relationship();
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

export class Fields {
    public data: Array<Field>;

    constructor(fields: Array<Field>) {
        this.data = fields;
    }

    /**
    * Gets all fields of a specified type
    * @param type Which type of field to get
    * @return An array of Field objects, which may be empty.
    */
    public getFieldsByType(type: FieldType): Array<Field> {
        let ret = [];
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
        let ret = [];
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

    public fromTLVBinaryData(binaryData: Buffer): Fields {
        return new Fields(parseTLVBinaryData(binaryData));
    }
}

export function parseTLVBinaryData(binaryData: Buffer): Array<FullField> {
    if (binaryData === undefined)
        throw new Error("Binary data not initialized");
    let fieldsArray = [];
    let index = CUBE_HEADER_LENGTH; // Start after date field
    while (index < binaryData.length) {
        const { type, length, valueStartIndex } = readTLVHeader(binaryData, index);
        const start = index; // Start of TLV field
        index = valueStartIndex;

        if (index + length <= binaryData.length) {  // Check if enough data for value field
            let value = binaryData.slice(index, index + length);
            fieldsArray.push({ type: type, start: start, length: length, value: value });
            index += length;
        } else {
            throw new Error("Data ended unexpectedly while reading value of field");
        }
    }
    return fieldsArray;
}

export function getFieldHeaderLength(fieldType: FieldType): number {
    return (FIELD_LENGTHS[fieldType] == undefined) ? 2 : 1;
}

export function updateTLVBinaryData(binaryData: Buffer, fields: Array<{ type: FieldType; length: number; value: Buffer }>): void {
    if (binaryData === undefined)
        throw new Error("Binary data not initialized");
    let index = CUBE_HEADER_LENGTH; // Start after date field
    for (let field of fields) {
        let { nextIndex } = writeTLVHeader(binaryData, field.type, field.length, index);
        index = nextIndex;

        if (index + field.length <= binaryData.length) {
            // Write value
            field.value.copy(binaryData, index);
            index += field.length;
        } else {
            logger.error(field.type + " field is too large, got " + field.length + " bytes, need " + (binaryData.length - index) + " bytes");
            throw new Error("Insufficient space in binaryData, got " + (index) + " bytes, need " + (index + field.length) + " bytes");
        }
    }
    // verify cube is full
    if (index != binaryData.length) {
        logger.error("Cube is not full, got " + index + " bytes, need " + binaryData.length + " bytes");
        throw new Error("Cube is not full, got " + index + " bytes, need " + binaryData.length + " bytes");
    }
}

export function writeTLVHeader(binaryData: Buffer, type: number, length: number, index: number): { nextIndex: number } {
    if (binaryData === undefined)
        throw new Error("Binary data not initialized");
    let implicitLength = FIELD_LENGTHS[type];
    if (implicitLength === undefined) {
        // Write type and length
        binaryData.writeUInt16BE((length & 0x03FF), index);
        binaryData[index] |= (type & 0xFC);
        index += 2;
    } else {
        // Write only type
        binaryData[index] = type;
        index += 1;
    }
    return { nextIndex: index };
}

export function readTLVHeader(binaryData: Buffer, index: number): { type: number, length: number, valueStartIndex: number } {
    // We first parse just type in order to detect whether a length field is present.
    // If the length field is present, we parse two bytes:
    // the first byte contains 6 bits of type information
    // and the last two bits of the first byte and the second byte contain the length
    // information.
    let type = binaryData[index] & 0xFC;
    if (!(type in FieldType))
        throw new Error("Invalid TLV type");
    let implicit = FIELD_LENGTHS[type];
    let length: number;
    if (implicit === undefined) {
        // Parse length
        length = binaryData.readUInt16BE(index) & 0x03FF;
        index += 2;
    } else { // Implicit length saved one byte
        length = implicit;
        index += 1;
    }
    return { type, length, valueStartIndex: index };
}
