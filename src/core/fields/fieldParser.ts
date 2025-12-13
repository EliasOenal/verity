import { ApiMisuseError, Settings } from "../settings";
import { BinaryDataError, FieldError } from "../cube/coreCube.definitions";
import { BaseField } from "./baseField";
import { BaseFields } from "./baseFields";
import { logger } from "../logger";
import { NetConstants } from "../networking/networkDefinitions";

import { Buffer } from 'buffer';

export type EnumType =  { [key: number|string]: number|string|undefined };
export type FieldBooleanParam = { [key: number]: boolean | undefined };
export type FieldNumericalParam = { [key: number]: number | undefined };
export type FieldFactoryParam = { [key: number]: () => BaseField | undefined };
export type PositionalFields = { [key: number]: number };

/**
 * @member fieldNames - An enum mapping field codes to field names and vice-versa.
 *         Note that all fields must be contained in this enum, even positional
 *         fields (for which a virtual field code must be assigned).
 * @member fieldLengths - An object mapping field codes to field lengths.
 *         Note that all fields defined under fieldNames must be present in this
 *         mapping. Variable length fields must be explicitly mapped to undefined.
 * @member fieldObjectClass - The class used to represent an individual field.
 *         Should be a subclass of BaseField. When decompiling binary data,
 *         FieldParser will instantiate one object of this class per field.
 * @member fieldsObjectClass - The class used to represent a collection of fields.
 *         Should be a subclass of BaseFields. When decompiling binary data,
 *         FieldParser will instantiate one object of this class which will
 *         contain a reference to every parsed field.
 * @member positionalFront - If the data to be parsed contains positional fields,
 *         i.e. fields without any header, at the start of the data blob,
 *         provide a mapper object describing them here. This object should map
 *         the running number of the field, counted from the front and starting
 *         at 1, to it's virtual field code.
 * @member positionalBack - If the data to be parsed contains positional fields,
 *         i.e. fields without any header, at the end of the data blob,
 *         provide a mapper object describing them here. This object should map
 *         the running number of the field, counted from the back and starting
 *         at 1, to it's virtual field code.
 * @member defaultField - May be used to specify default values for certain field types.
 *         This is only used by code creating default fields.
 *         A default of zero-length Buffer is assumed for all fields not specified.
 * @member firstFieldOffset - If there's any data at the front of your binary
 *         blobs which FieldParser should just ignore, specify the length in bytes.
 * @member stopField - A field code signalling to FieldParser that parsing
 *         should be stopped after processing this field. If the stop field is
 *         a regular content-bearing field, it's contents will still be parsed.
 *         Back positionals will still be parsed regardless and are never
 *         affected by stop fields.
 *         This option only affects decompiling, not compiling.
 * @member remainderField - Only to be used in conjunction with stopField.
 *         If a remainder field code is specified, FieldParser will create a
 *         virtual field of this code after the stop field containing all
 *         remaining binary data in the blob.
 *         This option only affects decompiling, not compiling.
 */
export interface FieldDefinition {
  fieldNames: EnumType;
  fieldLengths: FieldNumericalParam;
  fieldObjectClass: any,     // using type any as it turns out to be much to complex to declare a type of "class"
  fieldsObjectClass: any,    // using type any as it turns out to be much to complex to declare a type of "class"
  positionalFront?: FieldNumericalParam;
  positionalBack?: FieldNumericalParam;
  defaultField?: FieldFactoryParam;
  firstFieldOffset?: number;
  stopField?: number,
  remainderField?: number,
}

export class FieldParser {
  static normalizeFieldDefinition(fieldDef: FieldDefinition) {
    if (fieldDef.positionalFront === undefined) fieldDef.positionalFront = {};
    if (fieldDef.positionalBack === undefined) fieldDef.positionalBack = {};
    if (fieldDef.firstFieldOffset === undefined) fieldDef.firstFieldOffset = 0;
  }

  static validateFieldDefinition(fieldDef: FieldDefinition) {
    // Ensure all defined fields have a specified length or are explicitly
    // declared variable by setting their length to undefined
    for (const fieldType of Object.values(fieldDef.fieldNames)) {
      if (typeof fieldType === 'number') {  // filter out TypeScript-specific enum reverse mapping
        if (!(fieldType in fieldDef.fieldLengths)) {
          throw new ApiMisuseError(`Invalid field definition: No length specified for field type ${fieldType}, not even undefined.`);
        }
      }
    }
    // TODO: Ensure all field class IDs fit into NetConstants.FIELD_TYPE_SIZE
    // (or rather into a fixed size of 6 bits as we don't actually support
    // variably sized types just yet),
    // except those of positional fields (as those are local-only and will never
    // be actually used on the network).
    // Maybe also print a warning when a positional field ID *does* fit into the
    // type ID space as that's a waste of ID space and also plain confusing.
    //
    // TODO: Think about addional useful sanity checking
    return true;
  }

  /** If set to false we will ignore TLV and only decompile positional fields */
  decompileTlv: boolean = true;

  constructor(readonly fieldDef: FieldDefinition) {
    FieldParser.normalizeFieldDefinition(this.fieldDef);
    if (Settings.RUNTIME_ASSERTIONS) {
      FieldParser.validateFieldDefinition(this.fieldDef);
    }
  }

  /**
   * Takes an array of fields and gets you a Buffer of matching binary data.
   * @param fields An array of fields, which must be of the type described by
   *               this.fieldDef.fieldType
   * @returns The compiled binary data
   */
  compileFields(fields: BaseFields | Array<BaseField>): Buffer {
    if (!(fields instanceof BaseFields)) fields = new BaseFields(fields, this.fieldDef);
    this.finalizeFields(fields.all);            // prepare fields
    const buf = Buffer.alloc(                    // allocate buffer
      this.fieldDef.firstFieldOffset + fields.getByteLength());
    this.updateTLVBinaryData(buf, fields.all);  // write data into buffer
    return buf;
  }

  /**
   * Takes a binary Buffer of compiled fields and parses it for you into a neat
   * Field object array.
   * @returns An array of fields, the exact type of which being determined by
   *          this.fieldDef.fieldType.
   * @throws A (subclass of) FieldError when not parseable
   */
  decompileFields(binaryData: Buffer): BaseFields {
    if (binaryData === undefined)
      throw new BinaryDataError("Binary data not initialized");
    const fields: BaseField[] = [];

    // First, stip off and parse any back positional fields. We'll add them
    // back in in the end.
    const {backPositionals, dataLength} = this.decompileBackPositionalFields(binaryData);

    // Prepare for parsing: Respect initial offset, if any
    let byteIndex = this.fieldDef.firstFieldOffset;
    // Keep track of the running order (needed to handle positional fields)
    let fieldIndex = 0;

    // traverse binary data and parse fields:
    while (byteIndex < dataLength) {
      fieldIndex++;  // first field has number one
      const decompiled = this.decompileField(binaryData, byteIndex, fieldIndex);
      if (decompiled === undefined) break;  // undefined signals that we're done decompiling
      fields.push(decompiled.field);
      byteIndex = decompiled.byteIndex;
      // if this was a stop field, stop processing
      if (decompiled.field.type === this.fieldDef.stopField) {
        // create a remainder field if requested
        if (this.fieldDef.remainderField !== undefined) {
          const remainder: BaseField =
            this.virtualRemainderField(binaryData, byteIndex);
          fields.push(remainder);
        }
        break;
      }
    }
    const fieldArray: BaseField[] = fields.concat(backPositionals);
    const fieldsObj: BaseFields = new this.fieldDef.fieldsObjectClass(fieldArray, this.fieldDef);
    return fieldsObj;
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
    // Implemented as a static method so BaseField can use it, too.
    return FieldParser.getFieldHeaderLength(fieldType, this.fieldDef);
  }
  static getFieldHeaderLength(fieldType: number, fieldDef: FieldDefinition): number {
    // It's two bytes for "regular" TLV fields including length information,
    // just one byte for TLV fields with implicitly known length,
    // and zero for positional fields as they have no header.
    if (Object.values(fieldDef.positionalFront).includes(fieldType) ||
        Object.values(fieldDef.positionalBack).includes(fieldType)) {
      return 0;
    } else {
      return (fieldDef.fieldLengths[fieldType] === undefined) ?
        NetConstants.MESSAGE_CLASS_SIZE + NetConstants.FIELD_LENGTH_SIZE :
        NetConstants.MESSAGE_CLASS_SIZE;
    }
  }

  /** Decompiles a single field
   * @param binaryData The binary data to decompile from, obviously
   * @param byteIndex Where to start reading in binaryData
   * (note we could just slice the Buffer instead and that would arguably have
   * been the better design choice, but it's not what we did)
   * @param fieldIndex The running number of the field to be decompiled.
   * (This is needed to decompile front positional fields.)
   * @returns An object consisting of a BaseField object and the new byteIndex
   */
  private decompileField(binaryData: Buffer, byteIndex: number, fieldIndex: number): {field: BaseField, byteIndex: number } {
    const fieldStartsAtByte = byteIndex;
    let type: number, length: number;
    // Is this a positional field?
    type = this.frontPositionalFieldType(fieldIndex);
    if (type !== undefined) length = this.fieldDef.fieldLengths[type];
    // If it's not positional, it must be TLV. Are we supposed to decompile TLV?
    else if (!this.decompileTlv) { return undefined }
    // Yes? Okay, decompile TLV field.
    else ({type, length, byteIndex} = this.readTLVHeader(binaryData, byteIndex));

    // Check if our remaining binary buffer is long enough data for this kind of field
    if (byteIndex + length <= binaryData.length) {
      // Looks good, decompiling this field
      const value = binaryData.subarray(byteIndex, byteIndex + length);
      const field: BaseField = new this.fieldDef.fieldObjectClass(type, value, fieldStartsAtByte);
      // Field decompiled, now advance the binary data index
      byteIndex += length;
      return { field, byteIndex }
    } else {
      throw new BinaryDataError("Data ended unexpectedly while reading value of field");
    }
  }

  private virtualRemainderField(binaryData: Buffer, byteIndex: number): BaseField {
    const value = binaryData.subarray(byteIndex, binaryData.length);
    const field: BaseField = new this.fieldDef.fieldObjectClass(
      this.fieldDef.remainderField, value, byteIndex);
    return field;
  }

  private decompileBackPositionalFields(binaryData: Buffer): { backPositionals: BaseField[]; dataLength: number; } {
    const backPositionals: BaseField[] = [];
    let dataLength: number = binaryData.length;
    let backFieldIndex = 1;  // we always start counting fields at 1, even from the back
    let type = this.backPositionalFieldType(backFieldIndex);
    while (type !== undefined ) {
      const fieldLength = this.fieldDef.fieldLengths[type];
      if (dataLength >= fieldLength) {  // Check if enough data for field value
        const fieldStartsAtByte = dataLength-fieldLength;
        const value = binaryData.subarray(fieldStartsAtByte, dataLength);
        const field: BaseField = new this.fieldDef.fieldObjectClass(
          type, value, fieldStartsAtByte);
        backPositionals.unshift(field);
      } else {
        throw new BinaryDataError("Data too short, cannot contain all back positional fields specified.");
      }
      // update counters
      backFieldIndex++;
      dataLength -= fieldLength;
      // prepare next round
      type = this.backPositionalFieldType(backFieldIndex);
    }
    return { backPositionals, dataLength };
  }

  private updateTLVBinaryData(binaryData: Buffer, fields: Array<BaseField>): void {
    if (binaryData === undefined)
      throw new BinaryDataError("Binary data not initialized");
    let byteIndex = this.fieldDef.firstFieldOffset; // Respect initial offset. Currently unused.
    for (let fieldIndex: number = 1; fieldIndex <= fields.length; fieldIndex++) {
      const field: BaseField = fields[fieldIndex-1];
      // First, handle the field header. If it's positional, it has no header.
      if (this.isPositionalField(fields, fieldIndex)) {
        // assert the user has supplied the correct field
        if (field.type !== this.positionalFieldType(fields.length, fieldIndex)) {
          logger.error("FieldParser: Supplied field definition requires field type " + this.positionalFieldType(fields.length, fieldIndex) + " at position " + fieldIndex + ", however supplied field is of type " + field.type);
          throw new FieldError("FieldParser: Supplied field definition requires field type " + this.positionalFieldType(fields.length, fieldIndex) + " at position " + fieldIndex + ", however supplied field is of type " + field.type);
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
    // Sanity check: Does the field type fit?
    // Currently, type is hard coded as 6 bits while length is hard coded
    // 10 bits -- TODO generalize type and length field sizes
    if (type > 0xFC) {
      throw new FieldError(`FieldParser.writeTLVHeader: I was asked to write a field of type ${type}, but type codes can't be larger than 6 bits.`);
    }
    // Check if this field type has an implicit length.
    // If it does not, write both type and length.
    const implicitLength = this.fieldDef.fieldLengths[type];
    if (implicitLength === undefined) {
      // Sanity check: Does the length fit?
      if (length > 0x03FF) {
        throw new FieldError(`FieldParser.writeTLVHeader: I was asked to write a field of length ${length}, but lengths can't be larger than 10 bits.`);
      }
      // Write type and length
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

  private readTLVHeader(binaryData: Buffer, byteIndex: number): { type: number, length: number, byteIndex: number } {
    // We first parse just type in order to detect whether an implicit length
    // is defined.
    const type: number = binaryData[byteIndex] & 0xFC;
    const typestring: string = type.toString();  // object keys are strings, nothing I can do about it
    if ( !(Object.keys(this.fieldDef.fieldLengths).includes(typestring)) ) {
      throw new FieldError("Invalid TLV type " + typestring +", available types are: " + Object.keys(this.fieldDef.fieldLengths));
    }
    const implicit = this.fieldDef.fieldLengths[type];
    let length: number;
    // If the length is implicit, there is no length field.
    if (implicit === undefined) {
      // If however the length field is present, we parse two bytes:
      // the first byte contains 6 bits of type information
      // and the last two bits of the first byte and the second byte contain the length
      // information.
      length = binaryData.readUInt16BE(byteIndex) & 0x03FF;
      byteIndex += 2;
    } else { // Implicit length saved one byte
      length = implicit;
      byteIndex += 1;
    }
    return { type, length, byteIndex };
  }

  // helper function to improve readability
  private isPositionalField(fields: BaseField[], fieldIndex: number): boolean {
    return this.fieldDef.positionalFront.hasOwnProperty(fieldIndex.toString()) ||
           this.fieldDef.positionalBack.hasOwnProperty((fields.length-fieldIndex+1).toString());
  }

  private frontPositionalFieldType(fieldIndex: number): number {
    if (this.fieldDef.positionalFront.hasOwnProperty(fieldIndex.toString())) {
      return this.fieldDef.positionalFront[fieldIndex];
    } else {
      return undefined;
    }
  }

  private backPositionalFieldType(reverseFieldIndex: number): number {
    if (this.fieldDef.positionalBack.hasOwnProperty((reverseFieldIndex).toString())) {
      return this.fieldDef.positionalBack[reverseFieldIndex];
    }
    else return undefined;
  }


  // Note this can obviously only be used on compilation as during decompilation
  // the total field count is not know yet.
  // Thus, this is purely a helper method for compilation.
  private positionalFieldType(totalFieldCount: number, fieldIndex: number): number {
    // front positional field?
    const front = this.frontPositionalFieldType(fieldIndex);
    if (front !== undefined) return front;
    // back positional field?
    return this.backPositionalFieldType(totalFieldCount - fieldIndex + 1);
  }
}
