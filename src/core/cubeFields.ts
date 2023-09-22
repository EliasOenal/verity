import { BaseField, BaseRelationship, BaseFields, FieldDefinition, FieldNumericalParam, FieldRunningOrder as PositionalFields } from "./baseFields";
import { Settings } from "./config";
import { NetConstants } from "./networkDefinitions";

import { Buffer } from 'buffer';

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
  SIGNATURE = 0x06 << 2,
  SMART_CUBE = 0x07 << 2,
  PUBLIC_KEY = 0x08 << 2,

  // positional fields; assigned ID is for local purposes only
  VERSION = 0x101,
  DATE = 0x102,
}

export const CubeFieldLength: FieldNumericalParam = {
  [CubeFieldType.PADDING_NONCE]: undefined,
  [CubeFieldType.PAYLOAD]: undefined,
  [CubeFieldType.RELATES_TO]: NetConstants.RELATIONSHIP_TYPE_SIZE + NetConstants.CUBE_KEY_SIZE,
  [CubeFieldType.KEY_DISTRIBUTION]: 40,  // TODO calculate this based on NetConstants
  [CubeFieldType.SHARED_KEY]: 32,  // TODO calculate this based on NetConstants
  [CubeFieldType.ENCRYPTED]: undefined,
  [CubeFieldType.SIGNATURE]: NetConstants.SIGNATURE_SIZE,
  [CubeFieldType.SMART_CUBE]: 0, // Just a single header byte
  [CubeFieldType.PUBLIC_KEY]: NetConstants.PUBLIC_KEY_SIZE,
  [CubeFieldType.VERSION]: NetConstants.PROTOCOL_VERSION_SIZE,
  [CubeFieldType.DATE]: NetConstants.TIMESTAMP_SIZE,
};

/**
 * For positional fields, defines the running order this field must be at.
 * It follows that positional fields are both mandatory and can only occur once.
 * Note: The current implementation requires positional fields to be at the very
 * beginning. Positional fields at not supported and must be enforced at a higher
 * level, if required.
 * Note: In the current implementation, positional fields MUST have a defined length.
 * Note: Numbering starts at 1 (not 0).
 */
export const CubePositionalFields: PositionalFields = {
  1: CubeFieldType.VERSION,
  2: CubeFieldType.DATE,
};

export enum CubeRelationshipType {
  CONTINUED_IN = 1,
  MENTION = 2,
  REPLY_TO = 3,
  QUOTATION = 4,
}

/**
 * This represents a relationship between two cubes and is the object-representation
 * of a RELATES_TO field.
 */
export class CubeRelationship extends BaseRelationship {
  static fromField(field?: BaseField): CubeRelationship {
      return super.fromField(field, cubeFieldDefinition);
  }
}

export class CubeField extends BaseField {
  static relationshipType = CubeRelationship;

  static RelatesTo(rel: CubeRelationship): CubeField {
      return super.RelatesTo(rel, cubeFieldDefinition);
    }

  static Payload(buf: Buffer | string): CubeField  {
    return super.Payload(buf, cubeFieldDefinition);
  }
}

export class CubeFields extends BaseFields {
  constructor(data?: Array<CubeField> | CubeField, autoGenerateHeader: boolean = true) {
      super(data, cubeFieldDefinition);
      if (autoGenerateHeader) {
        // CubeFields must always start with a positional version and date field
        // Create a version field if there isn't already one.
        // maybe TODO: This does not ensure existing DATE and VERSION fields
        // are at the correct position
        // Note implementation detail: Creating header fields in reverse order
        // as we're inserting them at the beginning of the array with unshift
        if (this.getFirstField(CubeFieldType.DATE) == undefined) {
          const cubeDate: Buffer = Buffer.alloc(CubeFieldLength[CubeFieldType.DATE]);
          cubeDate.writeUIntBE(
            Math.floor(Date.now() / 1000), 0, CubeFieldLength[CubeFieldType.DATE]);
          this.insertFieldInFront(new CubeField(
            CubeFieldType.DATE, CubeFieldLength[CubeFieldType.DATE], cubeDate
          ));
        }
        if (this.getFirstField(CubeFieldType.VERSION) == undefined) {
          const cubeVersion: Buffer = Buffer.alloc(
            CubeFieldLength[CubeFieldType.VERSION]);
          // TODO document, move the literal 4 to config
          cubeVersion.writeUIntBE(Settings.CUBE_VERISION << 4,
                                  0, CubeFieldLength[CubeFieldType.VERSION]);
          this.insertFieldInFront(new CubeField(
            CubeFieldType.VERSION, CubeFieldLength[CubeFieldType.VERSION], cubeVersion
          ));
        }
      }
  }

  public getRelationships(type?: number): CubeRelationship[] {
      return super.getRelationships(type);
  }
  public getFirstRelationship(type?: number): CubeRelationship {
      return super.getFirstRelationship(type);
  }
}

// NOTE: Never move this to another file. This only works if it is defined
// strictly after CubeField. If you move it somewhere else, it's basically
// random whether it works or not and you can random undefined values in code
// coming from some files (but not others).
// Javascript is crazy.
export const cubeFieldDefinition: FieldDefinition = {
  fieldNames: CubeFieldType,
  fieldLengths: CubeFieldLength,
  positionalFields: CubePositionalFields,
  fieldObjectClass: CubeField,
  firstFieldOffset: 0,
}
