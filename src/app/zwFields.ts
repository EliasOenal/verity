import { BaseField, FieldDefinition, BaseFields, BaseRelationship } from "../core/baseFields";
import { Cube } from "../core/cube";
import { CubeField, CubeFieldType } from "../core/cubeFields";
import { FieldParser } from "../core/fieldParser";
import { logger } from "../core/logger";
import { NetConstants } from "../core/networkDefinitions";

import { Buffer } from 'buffer'

/**
 * Defines all possible types of second-level, application specific fields.
 * There may of course be many, potentially incompatible, standard of second-level
 * fields. This one is called "ZW" and is used for our microblogging application.
 */
export enum ZwFieldType {
  // Starting above 30 (out of a maximum of 63) to keep this conflict-free
  // with the top level types, even though this is not required.
  APPLICATION = 31 << 2,  // Should always contain "ZW". We won't tell you what that stands for.
  MEDIA_TYPE = 32 << 2,
  RELATES_TO = 33 << 2,
  PAYLOAD = 34 << 2,

  // Only used in MUCs:
  USERNAME = 51 << 2,
}

export const ZwFieldLengths: { [key: number]: number | undefined } = {
  [ZwFieldType.APPLICATION]: 2,
  [ZwFieldType.MEDIA_TYPE]: 1,
  [ZwFieldType.RELATES_TO]: NetConstants.RELATIONSHIP_TYPE_SIZE + NetConstants.CUBE_KEY_SIZE,
  [ZwFieldType.PAYLOAD]: undefined,
  [ZwFieldType.USERNAME]: undefined,
}

export enum ZwRelationshipType {
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

export enum MediaTypes {
  TEXT = 1,  // may contain markdown
  JPEG = 2,
  RESERVED = 255,  // may be used for an extension header
}

/**
 * Represents a relationship between two "ZW" cubes, i.e. two cubes containing
 * some second-level, application specific "ZW" fields, of which at least one is
 * a RELATES_TO ZW field.
 */
export class ZwRelationship extends BaseRelationship {
  static fromField(field?: BaseField): ZwRelationship {
    return super.fromField(field, zwFieldDefinition);
  }
}

/**
 * Represents a single application-specific, second-level field
 * which is located inside a top-level PAYLOAD cube field.
 * This specific type of application-specific second-level field is called "ZW",
 * and we won't tell you what that stands for.
 */
export class ZwField extends BaseField {
  static relationshipType = ZwRelationship;

  static Application(): ZwField {
    return new ZwField(ZwFieldType.APPLICATION, 2, Buffer.from("ZW", 'utf-8'));
  }

  static RelatesTo(rel: ZwRelationship): ZwField {
    return super.RelatesTo(rel, zwFieldDefinition);
  }

  static Payload(buf: Buffer | string): ZwField  {
    return super.Payload(buf, zwFieldDefinition);
  }

  static MediaType(type: MediaTypes) {
    return new ZwField(ZwFieldType.MEDIA_TYPE, 1, Buffer.alloc(1).fill(type));
  }

  static Username(name: string): ZwField {
    const buf = Buffer.from(name, 'utf-8');
    return new ZwField(ZwFieldType.USERNAME, buf.length, buf);
  }
}

/**
 * Represents a collection of application-specific, second-level fields
 * which are located inside a top-level PAYLOAD cube field.
 * This specific type of application-specific second-level fields is called "ZW",
 * and we won't tell you what that stands for.
 */
export class ZwFields extends BaseFields {
  static get(cube: Cube): ZwFields {
    // ZwFields live in the Cube's (first/only) PAYLOAD field.
    const zwData: CubeField = cube.getFields().getFirstField(CubeFieldType.PAYLOAD);
    if (!zwData) {
      // logger.info("ZwFields: Cannot get ZwFields from this Cube, there's no top-level PAYLOAD cube field.")
      return undefined;
    }
    // Decompile payload into ZwFields
    let zwFields = undefined;
    try {
      zwFields = new ZwFields(new FieldParser(zwFieldDefinition).decompileFields(zwData.value));
    } catch (err) { /* handled below */ }
    if (!zwFields) {
      // logger.info("ZwFields: Cannot get ZwFields from this Cube, the top-level PAYLOAD cube fields does not appear to be parseable as such.");
      return undefined;
    }
    // To distinguish it from garbage, a valid Zw field structure starts with
    // an APPLICATION ZwField containing "ZW". That's 24 bits of of known data,
    // meaning we will only falsely identiy a Cube as Zw-compliant every 16 billion
    // times.
    const AppField = zwFields.getFirstField(ZwFieldType.APPLICATION);
    if (!AppField || AppField.value.toString('utf-8') != "ZW") {
      // logger.info("ZwFields: Cannot get ZwFields from this Cube, there's no 'APPLICATION ZW' field so this is probably garbage.")
      return undefined;
    }

    return zwFields;
  }

  constructor(
    data?: Array<ZwField> | ZwField) {
      super(data, zwFieldDefinition);
  }

  public getRelationships(type?: number): Array<ZwRelationship> {
    return super.getRelationships(type);
  }

  public getFirstRelationship(type?: number): ZwRelationship {
    return super.getFirstRelationship(type);
  }
}

// NOTE: Never move this to another file. This only works if it is defined
// strictly after ZwField.
// Javascript is crazy.
export const zwFieldDefinition: FieldDefinition = {
  fieldNames: ZwFieldType,
  fieldLengths: ZwFieldLengths,
  fieldType: ZwField,
  firstFieldOffset: 0,
}
