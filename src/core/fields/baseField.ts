import { Buffer } from 'buffer';
import { FieldDefinition } from './fieldParser';

/**
 * A field is a data entry in binary TLV data.
 * This is the abstract base class for fields used on different levels of Verity.
 * In particular, Cubes consist of CubeFields, and CubeField inherits from this class.
 * You should best consider this an abstract base class, although it is not
 * technically abstract.
 */
export class BaseField {
 /**
 * Returns a new default field for the specified type. The default value is either:
 * - the default value specified in the field definition, or
 * - a buffer of the specified length filled with zeros, or
 * - a zero-length buffer if no length is specified.
 * @param fieldDefinition
 * @param type
 * @returns
 */
  static DefaultField(
    fieldDefinition: FieldDefinition,
    type: number,
  ): BaseField {
    // allocate a buffer of the correct length as specified in the field definition,
    // or zero-length if length is not specified
    const val: Buffer = Buffer.alloc(fieldDefinition.fieldLengths[type] ?? 0, 0);
    // if a default value is specified in the field definition,
    // copy it into the buffer
    fieldDefinition.defaultField[type]?.()?.value?.copy?.(val);
    return new fieldDefinition.fieldObjectClass(type, val);
  }

  type: number;  // In top-level fields, type will be one of FieldType (enum in cubeDefinitions.ts). Applications may or may not chose to keep their application-level fields compatible with our top-level numbering.
  value: Buffer;
  get valueString(): string { return this.value.toString('utf8') }
  get length(): number { return this.value?.length; }

  /**
   * Start of field as offset from beginning of cube (binaryData).
   * When creating a Cube, this is not know yet. Only when you finalize the
   * cube, i.e. compile it by calling getBinaryData() on it, these will be
   * calculated.
   * We refer to a field as a `full field` once this offset is know and you
   * can check whether a field is full by calling isFull().
   */
  start: number = undefined;

  constructor(type: number, value: Buffer | string, start?: number) {
      this.type = type;
      this.start = start;
      if (value instanceof Buffer) this.value = value;
      else this.value = Buffer.from(value, 'utf8');
  }

  equals(other: BaseField, compareStartOffset: boolean = false) {
      if (this.type != other.type) return false;
      if (!this.value.equals(other.value)) return false;
      if (compareStartOffset && this.start != other.start) return false;
      return true;
  }

  /**
   * Is this a finalized field, i.e. is it's start index within the compiled
   * binary data known yet?
   */
  isFinalized() {
      if (this.start !== undefined) return true;
      else return false;
  }

  toString(valEnc: BufferEncoding = 'hex'): string {
      return `Field type ${this.type}, value ${this.value.toString(valEnc)}`
  }
}
