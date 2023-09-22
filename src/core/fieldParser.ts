import { BinaryDataError, FieldError } from "./cubeDefinitions";
import { BaseFields, BaseField, FieldDefinition } from "./baseFields";
import { logger } from "./logger";
import { NetConstants } from "./networkDefinitions";
import { cubeFieldDefinition } from "./cubeFields";

import { Buffer } from 'buffer';

export class FieldParser {

  // TODO: add support for positional fields
  // TODO: add support for flag-type fields

  private static _toplevel = undefined;

  /**
   * @returns The (singleton) FieldParser for top-level fields.
   * Applications will need to create their own FieldParser(s) for any TLV
   * sub-fields they might want to use.
   */
  static get toplevel(): FieldParser {
    if (!FieldParser._toplevel) FieldParser._toplevel = new FieldParser(
      cubeFieldDefinition);
    return FieldParser._toplevel;
  }

  static validateFieldDefinition(fieldDef: FieldDefinition) {
    // Ensure all field class IDs fit into NetConstants.MESSAGE_CLASS_SIZE,
    // except those of positional fields (as those are local-only and will never
    // be actually used on the network).

    // TODO implement
    return true;
  }

  constructor(private fieldDef: FieldDefinition) {
    FieldParser.validateFieldDefinition(fieldDef);
  }

  /**
   * Takes an array of fields and gets you a Buffer of matching binary data.
   * @param fields An array of fields, which must be of the type described by
   *               this.fieldDef.fieldType
   */
  compileFields(fields: BaseFields | Array<BaseField>): Buffer {
    if (!(fields instanceof BaseFields)) fields = new BaseFields(fields, this.fieldDef);
    this.finalizeFields(fields.data);            // prepare fields
    const buf = Buffer.alloc(                    // allocate buffer
      this.fieldDef.firstFieldOffset + fields.getLength());
    this.updateTLVBinaryData(buf, fields.data);  // write data into buffer
    return buf;
  }

  /**
   * Takes a binary Buffer of compiled fields and parses it for you into a neat
   * Field object array.
   * @returns An array of fields, the exact type of which being determined by
   *          this.fieldDef.fieldType.
   * @throws A (subclass of) FieldError when not parseable
   */
  decompileFields(binaryData: Buffer): Array<BaseField> {
    if (binaryData === undefined)
      throw new BinaryDataError("Binary data not initialized");
    const fields = [];

    // Respect initial offset. For top-level headers, this leaves room for the date field
    let byteIndex = this.fieldDef.firstFieldOffset;
    // Keeps track of the running order. Needed to handle positional fields.
    let fieldIndex = 0;

    // traverse binary data and parse fields:
    while (byteIndex < binaryData.length) {
      const fieldStartsAtByte = byteIndex;
      let type: number;
      let length: number;
      fieldIndex++;  // first field has number one
      if (this.isPositionalField(fieldIndex)) {  // positional = no header
        type = this.fieldDef.positionalFields[fieldIndex];
        length = this.fieldDef.fieldLengths[type];
      } else {  // "regular", non-positional field sporting a TLV header
        ({type, length, byteIndex} = this.readTLVHeader(binaryData, byteIndex));
      }

      if (byteIndex + length <= binaryData.length) {  // Check if enough data for value field
        const value = binaryData.slice(byteIndex, byteIndex + length);
        fields.push(new this.fieldDef.fieldObjectClass(type, length, value, fieldStartsAtByte));
        byteIndex += length;
      } else {
        throw new BinaryDataError("Data ended unexpectedly while reading value of field");
      }
    }
    return fields;
}


  /**
   * Upgrade fields to full fields.
   * @param fields An array of fields, which must be of the type described by
   *               this.fieldDef.fieldType
   */
  finalizeFields(fields: Array<BaseField>): void {
    let start = this.fieldDef.firstFieldOffset;
    for (const field of fields) {
      field.start = start;
      start += this.getFieldHeaderLength(field.type) + field.length;  // TODO: generalize from the currently hardcoded 6 bit field type and 10 bit length
    }
  }

  getFieldHeaderLength(fieldType: number): number {
    // It's two bytes for "regular" fields including length informatione,
    // but just one byte for fields with implicitly known length.
    return FieldParser.getFieldHeaderLength(fieldType, this.fieldDef);
  }
  // TODO de-uglify
  static getFieldHeaderLength(fieldType: number, fieldDef: FieldDefinition): number {
    if (Object.values(fieldDef.positionalFields).includes(fieldType)) return 0;
    else return (fieldDef.fieldLengths[fieldType] == undefined) ?
      NetConstants.MESSAGE_CLASS_SIZE + NetConstants.FIELD_LENGTH_SIZE :
      NetConstants.MESSAGE_CLASS_SIZE;

  }

  private updateTLVBinaryData(binaryData: Buffer, fields: Array<BaseField>): void {
    if (binaryData === undefined)
      throw new BinaryDataError("Binary data not initialized");
    let byteIndex = this.fieldDef.firstFieldOffset; // Respect initial offset. Currently unused.
    for (let fieldIndex: number = 1; fieldIndex <= fields.length; fieldIndex++) {
      const field: BaseField = fields[fieldIndex-1];
      // First, handle the field header:
      if (this.isPositionalField(fieldIndex)) {
        // assert the user has supplied the correct field
        if (field.type !== this.fieldDef.positionalFields[fieldIndex]) {
          logger.error("FieldParser: Supplied field definition requires field type " + this.fieldDef.positionalFields[fieldIndex] + " at position " + fieldIndex + ", however supplied field is of type " + field.type);
          throw new FieldError("FieldParser: Supplied field definition requires field type " + this.fieldDef.positionalFields[fieldIndex] + " at position " + fieldIndex + ", however supplied field is of type " + field.type);
        }
      } else {  // only regular, non-positional fields have a header
        byteIndex = this.writeTLVHeader(binaryData, field.type, field.length, byteIndex);
      }
      // Now, write the field value:
      if (byteIndex + field.length <= binaryData.length) {  // assert that it fits
        field.value.copy(binaryData, byteIndex);
        byteIndex += field.length;
      } else {
        logger.error("FieldParser: " + field.type + " field is too large, got " + field.length + " bytes, need " + (binaryData.length - byteIndex) + " bytes");
        throw new BinaryDataError("Insufficient space in binaryData, got " + (byteIndex) + " bytes, need " + (byteIndex + field.length) + " bytes");
      }
    }
    // verify compiled header&field length exactly matches the allocated space
    if (byteIndex != binaryData.length) {
      logger.error("FieldParser: Space allocated for compiled TLV data does not match allocated space, data is " + byteIndex + " bytes, but allocated space is " + binaryData.length + " bytes.");
      throw new BinaryDataError("Space allocated for compiled TLV data does not match allocated space, data is " + byteIndex + " bytes, but allocated space is " + binaryData.length + " bytes.");
    }
  }

  private writeTLVHeader(binaryData: Buffer, type: number, length: number, index: number): number {
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
    return index;
  }

  private readTLVHeader(binaryData: Buffer, index: number): { type: number, length: number, byteIndex: number } {
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
    return { type, length, byteIndex: index };
  }

  // helper function to improve readability
  private isPositionalField(fieldIndex: number) {
    return this.fieldDef.positionalFields.hasOwnProperty(fieldIndex.toString());
  }

}