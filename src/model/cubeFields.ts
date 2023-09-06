import { BaseField, BaseRelationship, BaseFields, FieldDefinition } from "./baseFields";
import { CUBE_HEADER_LENGTH } from "./cubeDefinitions";
import { NetConstants } from "./networkDefinitions";

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
  constructor(data?: Array<CubeField> | CubeField) {
      super(data, cubeFieldDefinition);
  }

  public getRelationships(type?: number): CubeRelationship[] {
      return super.getRelationships(type, cubeFieldDefinition);
  }
  public getFirstRelationship(type?: number): CubeRelationship {
      return super.getFirstRelationship(type, cubeFieldDefinition);
  }
}

// NOTE: Never move this to another file. This only works if it is defined
// strictly after CubeField. If you move it somewhere else, it's basically
// random whether it works or not and you can random undefined values in code
// coming from some files (but not others).
// Javascript is crazy.
export const cubeFieldDefinition: FieldDefinition = {
  fieldNames: CubeFieldType,
  fieldLengths: CubeFieldLengths,
  fieldType: CubeField,
  firstFieldOffset: CUBE_HEADER_LENGTH,
}
