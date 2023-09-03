import { BinaryDataError, CUBE_HEADER_LENGTH, FieldError } from "./cube";
import { FIELD_LENGTHS, Fields, Field, FieldType } from "./fields";
import { logger } from "./logger";
import { NetConstants } from "./networkDefinitions";

interface FieldDefinition {
  firstFieldOffset: number;
  fieldLengths: object;  // maps field IDs to field lenghths,
                         // e.g. FIELD_LENGTHS defined in field.ts
}

export class FieldParser {
  private static _toplevel = undefined;

  /**
   * @returns The (singleton) FieldParser for top-level fields.
   * Applications will need to create their own FieldParser(s) for any TLV
   * sub-fields they might want to use.
   */
  static get toplevel(): FieldParser {
    if (!FieldParser._toplevel) FieldParser._toplevel = new FieldParser({
      firstFieldOffset: CUBE_HEADER_LENGTH,
      fieldLengths: FIELD_LENGTHS,
  });
  return FieldParser._toplevel;
}

  constructor(private fieldDef: FieldDefinition) { }

  getFieldHeaderLength(fieldType: number): number {
    // It's two bytes for "regular" fields including length informatione,
    // but just one byte for fields with implicitly known length.
    return (this.fieldDef.fieldLengths[fieldType] == undefined) ?
      NetConstants.MESSAGE_CLASS_SIZE + NetConstants.FIELD_LENGTH_SIZE :
      NetConstants.MESSAGE_CLASS_SIZE;
  }

  findFieldIndex(binaryData: Buffer, fieldType: FieldType, minLength: number = 0): number | undefined {
    let index = this.fieldDef.firstFieldOffset; // Respect initial offset. For top-level headers, this leaves room for the date field
    while (index < binaryData.length) {
      const { type, length, valueStartIndex } = this.readTLVHeader(binaryData, index);
      if (type === fieldType && length >= minLength) {
        return valueStartIndex; // Return the index of the start of the desired field value
      }
      index = valueStartIndex + length; // Move to the next field
    }
    return undefined; // Return undefined if the desired field is not found
  }

  updateTLVBinaryData(binaryData: Buffer, fields: Fields): void {
    if (binaryData === undefined)
      throw new BinaryDataError("Binary data not initialized");
    let index = this.fieldDef.firstFieldOffset; // Respect initial offset. For top-level headers, this leaves room for the date field
    for (const field of fields.data) {
      const { nextIndex } = this.writeTLVHeader(binaryData, field.type, field.length, index);
      index = nextIndex;

      if (index + field.length <= binaryData.length) {
        // Write value
        field.value.copy(binaryData, index);
        index += field.length;
      } else {
        logger.error(field.type + " field is too large, got " + field.length + " bytes, need " + (binaryData.length - index) + " bytes");
        throw new BinaryDataError("Insufficient space in binaryData, got " + (index) + " bytes, need " + (index + field.length) + " bytes");
      }
    }
    // verify compiled header&field length exactly matches the allocated space
    if (index != binaryData.length) {
      logger.error("Space allocated for compiled TLV data does not match allocated space, data is " + index + " bytes, but allocated space is " + binaryData.length + " bytes.");
      throw new BinaryDataError("Space allocated for compiled TLV data does not match allocated space, data is " + index + " bytes, but allocated space is " + binaryData.length + " bytes.");
    }
  }

  writeTLVHeader(binaryData: Buffer, type: number, length: number, index: number): { nextIndex: number } {
    if (binaryData === undefined)
      throw new BinaryDataError("Binary data not initialized");
    const implicitLength = this.fieldDef.fieldLengths[type];
    if (implicitLength === undefined) {
      // Write type and length -- TODO generalize type and length field sizes
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

  readTLVHeader(binaryData: Buffer, index: number): { type: number, length: number, valueStartIndex: number } {
    // We first parse just type in order to detect whether a length field is present.
    // If the length field is present, we parse two bytes:
    // the first byte contains 6 bits of type information
    // and the last two bits of the first byte and the second byte contain the length
    // information.
    const type: number = binaryData[index] & 0xFC;
    const typestring: string = type.toString();  // object keys are strings, nothing I can do about it
    if ( !(Object.keys(this.fieldDef.fieldLengths).includes(typestring)) ) {
      throw new FieldError("Invalid TLV type " + typestring +", available types are: " + Object.keys(this.fieldDef.fieldLengths));
    }
    const implicit = this.fieldDef.fieldLengths[type];
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

  parseTLVBinaryData(binaryData: Buffer): Fields {
    if (binaryData === undefined)
      throw new BinaryDataError("Binary data not initialized");
    const fields: Fields = new Fields();
    let index = this.fieldDef.firstFieldOffset; // Respect initial offset. For top-level headers, this leaves room for the date field
    while (index < binaryData.length) {
      const { type, length, valueStartIndex } = this.readTLVHeader(binaryData, index);
      const start = index; // Start of TLV field
      index = valueStartIndex;

      if (index + length <= binaryData.length) {  // Check if enough data for value field
        const value = binaryData.slice(index, index + length);
        fields.data.push(new Field(type, length, value, start));
        index += length;
      } else {
        throw new BinaryDataError("Data ended unexpectedly while reading value of field");
      }
    }
    return fields;
}



}