import { Cube } from "../core/cube/cube";
import { CubeField, CubeFieldLength, CubeFieldType, CubeFields, FieldParserTable, dumbPositionalBack, dumbPositionalFront, mucPositionalBack, mucPositionalFront } from "../core/cube/cubeFields";
import { FieldDefinition, FieldNumericalParam, FieldParser } from "../core/fieldParser";
import { logger } from "../core/logger";
import { NetConstants } from "../core/networking/networkDefinitions";

import { Buffer } from 'buffer'
import { Settings } from "../core/settings";
import { BaseField, BaseFields } from "../core/cube/baseFields";
import { CubeKey, CubeType, WrongFieldType } from "../core/cube/cubeDefinitions";
import { cciConstants } from "./cciDefinitions";

// HACKHACK: For proper layering, this file should define CCI field IDs and
// associated length data. These should extend the base CubeFieldTypes.
// However, TypeScript lacks a proper way to extend enums.
// Therefore, CCI currently uses the core's CubeFieldTypes, which include
// CCI fields even though they don't belong there.
export const cciFieldType = CubeFieldType;
export const cciFieldLength = CubeFieldLength;

export enum cciRelationshipType {
  CONTINUED_IN = 1,
  MENTION = 2,
  REPLY_TO = 3,
  QUOTATION = 4,
  MYPOST = 5,

  // Only used in MUCs:
  PROFILEPIC = 71,
  KEY_BACKUP_CUBE = 72,
  SUBSCRIPTION_RECOMMENDATION_INDEX = 73,

  // Only used in MUC extension cubes:
  SUBSCRIPTION_RECOMMENDATION = 81,
}

export const cciRelationshipLimits: Map<cciRelationshipType, number> = new Map([
  [cciRelationshipType.CONTINUED_IN, 1],
  [cciRelationshipType.MENTION, undefined],
  [cciRelationshipType.REPLY_TO, 1],
  [cciRelationshipType.QUOTATION, undefined],
  [cciRelationshipType.MYPOST, undefined],
  [cciRelationshipType.PROFILEPIC, 1],
  [cciRelationshipType.KEY_BACKUP_CUBE, undefined],
  [cciRelationshipType.SUBSCRIPTION_RECOMMENDATION_INDEX, undefined],
  [cciRelationshipType.SUBSCRIPTION_RECOMMENDATION, undefined]
]);

export enum MediaTypes {
  TEXT = 1,  // may contain markdown
  JPEG = 2,
  RESERVED = 255,  // may be used for an extension header
}

/**
 * Represents a relationship between two cubes
 */
export class cciRelationship {
  /** Described the kind of relationship */
  type: number;
  remoteKey: CubeKey;

  constructor(type: number = undefined, remoteKey: CubeKey = undefined) {
      this.type = type;
      this.remoteKey = remoteKey;
  }

  static fromField(field: cciField): cciRelationship {
      const relationship = new cciRelationship;
      if (field.type != cciFieldType.RELATES_TO) {
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

/**
 * CCI fields represent a common framework for application-level fields.
 * A cciField object represents a single CCI-compliant field in a Cube.
 */
export class cciField extends CubeField {
  static relationshipType = cciRelationship;

  static SubkeySeed(buf: Buffer | Uint8Array): CubeField {
    if (!(buf instanceof Buffer)) buf = Buffer.from(buf);
    return new CubeField(CubeFieldType.SUBKEY_SEED, buf.length, buf as Buffer);
  }

  static Application(applicationString: string): cciField {
    if (applicationString.length != cciConstants.APPLICATION_ID_LENGTH) {
    } else {
      return new cciField(cciFieldType.APPLICATION, 2, Buffer.from(applicationString));
    }
  }

  static RelatesTo(rel: cciRelationship) {
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
    return new cciField(
      cciFieldType.RELATES_TO, cciFieldLength[cciFieldType.RELATES_TO], value);
}


  static Payload(buf: Buffer | string): cciField  {
    return super.Payload(buf);
  }

  static MediaType(type: MediaTypes) {
    return new cciField(cciFieldType.MEDIA_TYPE, 1, Buffer.alloc(1).fill(type));
  }

  static Username(name: string): cciField {
    const buf = Buffer.from(name, 'utf-8');
    return new cciField(cciFieldType.USERNAME, buf.length, buf);
  }
}

/**
 * A cciFields object is a wrapper object for the list of fields contained
 * in a CCI-compliant Cube.
 */
export class cciFields extends CubeFields {
  static Dumb(
    data: CubeFields | CubeField[] | CubeField = [],
    fieldDefinition: FieldDefinition = cciDumbFieldDefinition
  ): cciFields {
    return super.Dumb(data, fieldDefinition) as cciFields;
  }

  static Muc(
    publicKey: Buffer | Uint8Array,
    data: CubeFields | CubeField[] | CubeField = [],
    fieldDefinition: FieldDefinition = cciMucFieldDefinition
  ): cciFields {
    return super.Muc(publicKey, data, fieldDefinition) as cciFields;
  }

  constructor(
      data: Array<cciField> | cciField | undefined,
      fieldDefinition: FieldDefinition) {
    super(data, fieldDefinition);
  }

  /**
  * Gets the relationships this cube has to other cubes, if any.
  * @param [type] If specified, only get relationships of the specified type.
  * @return An array of Relationship objects, which may be empty.
  */
  public getRelationships(type?: number): Array<cciRelationship> {
    const relationshipfields = this.get(cciFieldType.RELATES_TO);
    const ret = [];
    for (const relationshipfield of relationshipfields) {
      const relationship: cciRelationship =
        cciRelationship.fromField(relationshipfield);
      if (!type || relationship.type == type) ret.push(relationship);
    }
    return ret;
  }


  public getFirstRelationship(type?: number): cciRelationship {
    const rels: Array<cciRelationship> = this.getRelationships(type);
    if (rels.length) return rels[0];
    else return undefined;
  }
}

// NOTE: Never move this to another file. This only works if it is defined
// strictly after cciField.
// Javascript is crazy.
export const cciDumbFieldDefinition: FieldDefinition = {
  fieldNames: cciFieldType,
  fieldLengths: cciFieldLength,
  positionalFront: dumbPositionalFront,
  positionalBack: dumbPositionalBack,
  fieldObjectClass: cciField,
  fieldsObjectClass: cciFields,
  firstFieldOffset: 0,
}
export const cciMucFieldDefinition: FieldDefinition = {
  fieldNames: cciFieldType,
  fieldLengths: cciFieldLength,
  positionalFront: mucPositionalFront,
  positionalBack: mucPositionalBack,
  fieldObjectClass: cciField,
  fieldsObjectClass: cciFields,
  firstFieldOffset: 0,
}
export const cciDumbParser: FieldParser = new FieldParser(cciDumbFieldDefinition);
export const cciMucParser: FieldParser = new FieldParser(cciMucFieldDefinition);

export const cciFieldParsers: FieldParserTable = {} // lookup table
cciFieldParsers[CubeType.DUMB] = cciDumbParser;
cciFieldParsers[CubeType.MUC] = cciMucParser;
