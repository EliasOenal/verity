import { NetConstants } from "../networking/networkDefinitions";

import { BaseFields, FieldPosition } from "../fields/baseFields";
import { FieldDefinition, FieldParser } from "../fields/fieldParser";

import { coreCubeFamily, type Cube } from "./cube";
import { CubeField } from "./cubeField";

import { Buffer } from 'buffer';
import { CubeFieldType, CubeType, CubeFieldLength, FrozenCorePositionalFront, FrozenPositionalBack, FrozenNotifyCorePositionalFront, FrozenNotifyPositionalBack, PicCorePositionalFront, PicPositionalBack, PicNotifyCorePositionalFront, PicNotifyPositionalBack, MucCorePositionalFront, MucPositionalBack, MucNotifyCorePositionalFront, MucNotifyPositionalBack, PmucCorePositionalFront, PmucPositionalBack, PmucNotifyCorePositionalFront, PmucNotifyPositionalBack, FrozenPositionalFront, MucPositionalFront, FrozenDefaultFields, FrozenNotifyDefaultFields, PicDefaultFields, PicNotifyDefaultFields, MucDefaultFields, MucNotifyDefaultFields, PmucDefaultFields, PmucNotifyDefaultFields, HasNotify, ToggleNotifyType, RawcontentFieldType } from "./cube.definitions";

export class CubeFields extends BaseFields {
  static CorrectNotifyType(type: CubeType, fields: CubeFields | CubeField[] | CubeField) {
    // normalize input
    if (fields instanceof CubeFields) fields = fields.all;
    if (fields instanceof CubeField) fields = [fields];
    if (!fields) fields = [];
    // We need to toggle the type if:
    if ((  // - there's a notify field but the type is non-notification
          CubeFields.getFirst(fields, CubeFieldType.NOTIFY) !== undefined &&
          !HasNotify[type]
        ) || (  // - there's no notify field but the type is notification
          CubeFields.getFirst(fields, CubeFieldType.NOTIFY) === undefined &&
          HasNotify[type]
        )
    ){
      return ToggleNotifyType[type];
    } else {
        return type;
    }
  }

  /**
   * Helper function to create a valid frozen cube field set for you.
   * Just supply your payload fields and we'll take care of the rest.
   * You can also go a step further and just use Cube.Frozen() for even more
   * convenience, which will then in turn call us.
   * @deprecated Use DefaultPositionals() directly please
   **/
  static Frozen(
      data: CubeFields | CubeField[] | CubeField = undefined,
      fieldDefinition: FieldDefinition = CoreFrozenFieldDefinition
  ): CubeFields {
    return this.DefaultPositionals(fieldDefinition, data) as CubeFields;
  }

  /**
   * Helper function to create a valid MUC field set for you.
   * Just supply your payload fields and we'll take care of the rest.
   * You can also go a step further and just use Cube.MUC() for even more
   * convenience, which will then in turn call us.
   * @deprecated Use DefaultPositionals() directly please
   **/
  static Muc(
      publicKey: Buffer | Uint8Array,
      data: CubeFields | CubeField[] | CubeField = undefined,
      fieldDefinition: FieldDefinition = CoreMucFieldDefinition
  ): CubeFields {
    // HACKHACK, we should get rid of this method anyway
    const fieldsObj: CubeFields = new CubeFields(data, fieldDefinition);
    fieldsObj.ensureFieldInBack(CubeFieldType.PUBLIC_KEY, fieldDefinition.fieldObjectClass.PublicKey(publicKey as Buffer));
    return this.DefaultPositionals(fieldDefinition, fieldsObj) as CubeFields;
  }

  static DefaultPositionals(
    fieldDefinition: FieldDefinition,
    data: CubeFields | CubeField[] | CubeField | undefined = undefined,
  ): CubeFields {
    return super.DefaultPositionals(fieldDefinition, data) as CubeFields;
  }

  static ContentBytesAvailable(
      cubeType: CubeType,
  ): number {
    return CubeFieldLength[RawcontentFieldType[cubeType]];
  }

  bytesRemaining(max: number = NetConstants.CUBE_SIZE): number {
    return max - this.getByteLength();
  }

}

/**
 * A CubeFamily describes our local interpretation of a Cube, based on the way
 * how we parse it. Contrary to a CubeType, which is a real thing and exists
 * while a Cube is in transit through the network, CubeFamily is an implementation
 * detail; you could argue that it's not real.
 * A CubeFamily consists of two parts, a CubeClass and a FieldParserTable.
 * The CubeClass is the class we use to instantiate Cubes of this family and is
 * usually a subclass of Cube. The FieldParserTable defines how a Cube is
 * compiled and decompiled, i.e. how we parse its fields.
 * There are currently two main CubeFamily definitions, coreCubeFamily and
 * cciFamily. cciFamily describes Cubes parsed according to CCI rules and is,
 * obviously, relevant to CCI-compliant application.
 * coreCubeFamily describes Cubes for which we do not parse any TLV fields;
 * this is only relevant to server-only nodes which only store and forward
 * Cubes but are not interested at all in their payload.
 **/
export interface CubeFamilyDefinition {
  cubeClass: typeof Cube,
  parsers: FieldParserTable,
}
export interface FieldParserTable {  // this implements a lookup table
  [n: number]: FieldParser;
}

// Introducing the Core Cube family, describing Cubes parsed only for their
// positional fields, ignoring any TLV information and presenting their raw
// content as a single field.
// This is how forwarding-only, "server" nodes parse Cubes as they just
// don't care about their contents.

// NOTE: Never move any this to another file. This only works if it is defined
// strictly after CubeField. If you move it somewhere else, it's basically
// random whether it works or you get random undefined values in code
// coming from some files (but not others).
// Javascript is crazy.

export const CoreFrozenFieldDefinition: FieldDefinition = {
  fieldNames: CubeFieldType,
  fieldLengths: CubeFieldLength,
  positionalFront: FrozenCorePositionalFront,
  positionalBack: FrozenPositionalBack,
  defaultField: FrozenDefaultFields,
  fieldObjectClass: CubeField,
  fieldsObjectClass: CubeFields,
  firstFieldOffset: 0,
};
export const CoreFrozenNotifyFieldDefinition: FieldDefinition = {
  fieldNames: CubeFieldType,
  fieldLengths: CubeFieldLength,
  positionalFront: FrozenNotifyCorePositionalFront,
  positionalBack: FrozenNotifyPositionalBack,
  defaultField: FrozenNotifyDefaultFields,
  fieldObjectClass: CubeField,
  fieldsObjectClass: CubeFields,
  firstFieldOffset: 0,
};
export const CorePicFieldDefinition: FieldDefinition = {
  fieldNames: CubeFieldType,
  fieldLengths: CubeFieldLength,
  positionalFront: PicCorePositionalFront,
  positionalBack: PicPositionalBack,
  defaultField: PicDefaultFields,
  fieldObjectClass: CubeField,
  fieldsObjectClass: CubeFields
};
export const CorePicNotifyFieldDefinition: FieldDefinition = {
  fieldNames: CubeFieldType,
  fieldLengths: CubeFieldLength,
  positionalFront: PicNotifyCorePositionalFront,
  positionalBack: PicNotifyPositionalBack,
  defaultField: PicNotifyDefaultFields,
  fieldObjectClass: CubeField,
  fieldsObjectClass: CubeFields,
  firstFieldOffset: 0,
};
export const CoreMucFieldDefinition: FieldDefinition = {
  fieldNames: CubeFieldType,
  fieldLengths: CubeFieldLength,
  positionalFront: MucCorePositionalFront,
  positionalBack: MucPositionalBack,
  defaultField: MucDefaultFields,
  fieldObjectClass: CubeField,
  fieldsObjectClass: CubeFields,
  firstFieldOffset: 0,
};
export const CoreMucNotifyFieldDefinition: FieldDefinition = {
  fieldNames: CubeFieldType,
  fieldLengths: CubeFieldLength,
  positionalFront: MucNotifyCorePositionalFront,
  positionalBack: MucNotifyPositionalBack,
  defaultField: MucNotifyDefaultFields,
  fieldObjectClass: CubeField,
  fieldsObjectClass: CubeFields,
  firstFieldOffset: 0,
};
export const CorePmucFieldDefinition: FieldDefinition = {
  fieldNames: CubeFieldType,
  fieldLengths: CubeFieldLength,
  positionalFront: PmucCorePositionalFront,
  positionalBack: PmucPositionalBack,
  defaultField: PmucDefaultFields,
  fieldObjectClass: CubeField,
  fieldsObjectClass: CubeFields,
  firstFieldOffset: 0,
};
export const CorePmucNotifyFieldDefinition: FieldDefinition = {
  fieldNames: CubeFieldType,
  fieldLengths: CubeFieldLength,
  positionalFront: PmucNotifyCorePositionalFront,
  positionalBack: PmucNotifyPositionalBack,
  defaultField: PmucNotifyDefaultFields,
  fieldObjectClass: CubeField,
  fieldsObjectClass: CubeFields,
  firstFieldOffset: 0,
};

// The (singleton) FieldParser for all standard Cube types, supporting
// core fields only.
// Applications will need to create their own FieldParser(s) for any
// custom/payload fields they might want to use.
// CCI provides an optional interface for this.
const CoreFrozenParser: FieldParser = new FieldParser(CoreFrozenFieldDefinition);
CoreFrozenParser.decompileTlv = false;  // core-only nodes ignore TLV

const CoreFrozenNotifyParser: FieldParser = new FieldParser(CoreFrozenNotifyFieldDefinition);
CoreFrozenNotifyParser.decompileTlv = false;  // core-only nodes ignore TLV

const CorePicParser: FieldParser = new FieldParser(CorePicFieldDefinition);
CorePicParser.decompileTlv = false;  // core-only nodes ignore TLV

const CorePicNotifyParser: FieldParser = new FieldParser(CorePicNotifyFieldDefinition);
CorePicNotifyParser.decompileTlv = false;  // core-only nodes ignore TLV

const CoreMucParser: FieldParser = new FieldParser(CoreMucFieldDefinition);
CoreMucParser.decompileTlv = false;  // core-only nodes ignore TLV

const CoreMucNotifyParser: FieldParser = new FieldParser(CoreMucNotifyFieldDefinition);
CoreMucNotifyParser.decompileTlv = false;  // core-only nodes ignore TLV

const CorePmucParser: FieldParser = new FieldParser(CorePmucFieldDefinition);
CorePmucParser.decompileTlv = false;  // core-only nodes ignore TLV

const CorePmucNotifyParser: FieldParser = new FieldParser(CorePmucNotifyFieldDefinition);
CorePmucNotifyParser.decompileTlv = false;  // core-only nodes ignore TLV

// FieldParserTable for the raw Cube family
export const CoreFieldParsers: FieldParserTable = {
  [CubeType.FROZEN]: CoreFrozenParser,
  [CubeType.FROZEN_NOTIFY]: CoreFrozenNotifyParser,
  [CubeType.PIC]: CorePicParser,
  [CubeType.PIC_NOTIFY]: CorePicNotifyParser,
  [CubeType.MUC]: CoreMucParser,
  [CubeType.MUC_NOTIFY]: CoreMucNotifyParser,
  [CubeType.PMUC]: CorePmucParser,
  [CubeType.PMUC_NOTIFY]: CorePmucNotifyParser,
}

// CoreCubeFamily itself defined in cube.ts as, again, Javascript is annoying
