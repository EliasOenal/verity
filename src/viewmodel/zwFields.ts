import { BaseField, FieldDefinition, BaseFields, BaseRelationship } from "../model/baseFields";
import { NetConstants } from "../model/networkDefinitions";

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


export class ZwField extends BaseField {
  static Application(): ZwField {
    return new ZwField(ZwFieldType.APPLICATION, 2, Buffer.from("ZW", 'utf-8'));
  }

  static RelatesTo(rel: BaseRelationship): ZwField {
    return super.RelatesTo(rel, zwFieldDefinition);
  }

  static Payload(buf: Buffer | string): ZwField  {
    return super.Payload(buf, zwFieldDefinition);
  }

  static Username(name: string): ZwField {
    const buf = Buffer.from(name, 'utf-8');
    return new ZwField(ZwFieldType.USERNAME, buf.length, buf);
  }
}

export class ZwFields extends BaseFields {
  constructor(
    data?: Array<BaseField> | BaseField) {
      super(data, zwFieldDefinition);
  }

  public getRelationships(type?: number): Array<BaseRelationship> {
    return super.getRelationships(type, zwFieldDefinition);
  }

  public getFirstRelationship(type?: number): BaseRelationship {
    return super.getFirstRelationship(type, zwFieldDefinition);
  }
}

export class ZwRelationship extends BaseRelationship {
  static fromField(field?: BaseField): ZwRelationship {
    return super.fromField(field, zwFieldDefinition);
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
