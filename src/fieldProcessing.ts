import { Buffer } from 'buffer';
import { logger } from './logger';
import { Cube, CUBE_HEADER_LENGTH, WrongFieldType } from './cube';
import { NetConstants } from './networkDefinitions';

export enum FieldType {
    PADDING_NONCE = 0x00 << 2,
    PAYLOAD = 0x01 << 2,
    RELATES_TO = 0x02 << 2,
    KEY_DISTRIBUTION = 0x03 << 2,
    SHARED_KEY = 0x04 << 2,
    ENCRYPTED = 0x05 << 2,
    TYPE_SIGNATURE = 0x06 << 2,
    TYPE_SPECIAL_CUBE = 0x07 << 2,
    TYPE_PUBLIC_KEY = 0x08 << 2,
}

export const FIELD_LENGTHS: { [key: number]: number | undefined } = {
    [FieldType.PAYLOAD]: undefined,
    [FieldType.RELATES_TO]: 33,
    [FieldType.PADDING_NONCE]: undefined,
    [FieldType.KEY_DISTRIBUTION]: 40,
    [FieldType.SHARED_KEY]: 32,
    [FieldType.ENCRYPTED]: undefined,
    [FieldType.TYPE_SIGNATURE]: 72,
    [FieldType.TYPE_SPECIAL_CUBE]: 0, // Just a single header byte
    [FieldType.TYPE_PUBLIC_KEY]: 32,
};

export enum SpecialCubeType {
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

export interface Field {
    type: FieldType;
    length: number;
    value: Buffer;
}

export class Relationship {
    type: RelationshipType;
    remoteKey: string;

    constructor(type = undefined, remoteKey = undefined) {
        this.type = type;
        this.remoteKey = remoteKey;
    }

    static fromField(field?: Field) {
        let relationship = new Relationship();
        if (field.type != FieldType.RELATES_TO) {
            throw(new WrongFieldType(
                "Can only construct relationship object from RELATES_TO field, " +
                "got " + field.type + "."));
        }
        relationship.type = field.value.readIntBE(0, NetConstants.RELATIONSHIP_TYPE_SIZE);
        relationship.remoteKey = field.value.subarray(
            NetConstants.RELATIONSHIP_TYPE_SIZE,
            NetConstants.RELATIONSHIP_TYPE_SIZE + NetConstants.CUBE_KEY_SIZE).
            toString('hex');
        return relationship;
    }
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

export function parseTLVBinaryData(binaryData: Buffer): Array<Field | FullField> {
    if (binaryData === undefined)
        throw new Error("Binary data not initialized");
    let fields = []; // Clear any existing fields
    let index = CUBE_HEADER_LENGTH; // Start after date field
    while (index < binaryData.length) {
        const { type, length, valueStartIndex } = readTLVHeader(binaryData, index);
        const start = index; // Start of TLV field
        index = valueStartIndex;

        if (index + length <= binaryData.length) {  // Check if enough data for value field
            let value = binaryData.slice(index, index + length);
            fields.push({ type: type, start: start, length: length, value: value });
            index += length;
        } else {
            throw new Error("Data ended unexpectedly while reading value of field");
        }
    }
    return fields;
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
