import { FieldDefinition, FieldParser, PositionalFields } from "../fields/fieldParser";
import { CubeType } from "./cubeDefinitions";
import { CubeFieldType, CubeFieldLength, CubeField } from "./cubeField";
import { CubeFields, FieldParserTable } from "./cubeFields";

// Core raw Cube family -- describing Cubes parsed for their positional fields
// and exposing all TLV data, including any potential padding, as a single
// RAWCONTENT blob.
// TODO: This should be used as the default family throughout the core

// Positional field definitions for the raw Cube family
export const RawFrozenFields: PositionalFields = {
  1: CubeFieldType.TYPE,
  2: CubeFieldType.FROZEN_RAWCONTENT,
  3: CubeFieldType.DATE,
  4: CubeFieldType.NONCE,
};
export const RawFrozenFieldsWithNotify: PositionalFields = {
  1: CubeFieldType.TYPE,
  2: CubeFieldType.FROZEN_NOTIFY_RAWCONTENT,
  3: CubeFieldType.NOTIFY,
  4: CubeFieldType.DATE,
  5: CubeFieldType.NONCE,
}
export const RawPicFields: PositionalFields = {
  1: CubeFieldType.TYPE,
  2: CubeFieldType.PIC_RAWCONTENT,
  3: CubeFieldType.DATE,
  4: CubeFieldType.NONCE,
};
export const RawPicFieldsWithNotify: PositionalFields = {
  1: CubeFieldType.TYPE,
  2: CubeFieldType.PIC_NOTIFY_RAWCONTENT,
  3: CubeFieldType.NOTIFY,
  4: CubeFieldType.DATE,
  5: CubeFieldType.NONCE,
};
export const RawMucFields: PositionalFields = {
  1: CubeFieldType.TYPE,
  2: CubeFieldType.MUC_RAWCONTENT,
  3: CubeFieldType.PUBLIC_KEY,
  4: CubeFieldType.DATE,
  5: CubeFieldType.SIGNATURE,
  6: CubeFieldType.NONCE,
};
export const RawMucFieldsWithNotify: PositionalFields = {
  1: CubeFieldType.TYPE,
  2: CubeFieldType.MUC_NOTIFY_RAWCONTENT,
  3: CubeFieldType.NOTIFY,
  4: CubeFieldType.PUBLIC_KEY,
  5: CubeFieldType.DATE,
  6: CubeFieldType.SIGNATURE,
  7: CubeFieldType.NONCE,
};
export const RawPmucFields: PositionalFields = {
  1: CubeFieldType.TYPE,
  2: CubeFieldType.PMUC_RAWCONTENT,
  3: CubeFieldType.PMUC_UPDATE_COUNT,
  4: CubeFieldType.PUBLIC_KEY,
  5: CubeFieldType.DATE,
  6: CubeFieldType.SIGNATURE,
  7: CubeFieldType.NONCE,
};
export const RawPmucFieldsWithNotify: PositionalFields = {
  1: CubeFieldType.TYPE,
  2: CubeFieldType.PMUC_NOTIFY_RAWCONTENT,
  3: CubeFieldType.NOTIFY,
  4: CubeFieldType.PMUC_UPDATE_COUNT,
  5: CubeFieldType.PUBLIC_KEY,
  6: CubeFieldType.DATE,
  7: CubeFieldType.SIGNATURE,
  8: CubeFieldType.NONCE,
};

// Field definition objects as used by the FieldParser
export const RawFrozenFieldDefinition: FieldDefinition = {
  fieldNames: CubeFieldType,
  fieldLengths: CubeFieldLength,
  positionalFront: RawFrozenFields,
  positionalBack: {},
  fieldObjectClass: CubeField,
  fieldsObjectClass: CubeFields,
  firstFieldOffset: 0,
};
export const RawFrozenFieldDefinitionWithNotify: FieldDefinition = {
  fieldNames: CubeFieldType,
  fieldLengths: CubeFieldLength,
  positionalFront: RawFrozenFieldsWithNotify,
  positionalBack: {},
  fieldObjectClass: CubeField,
  fieldsObjectClass: CubeFields,
  firstFieldOffset: 0,
};
export const RawPicFieldDefinition: FieldDefinition = {
  fieldNames: CubeFieldType,
  fieldLengths: CubeFieldLength,
  positionalFront: RawPicFields,
  positionalBack: {},
  fieldObjectClass: CubeField,
  fieldsObjectClass: CubeFields
};
export const RawPicFieldDefinitionWithNotify: FieldDefinition = {
  fieldNames: CubeFieldType,
  fieldLengths: CubeFieldLength,
  positionalFront: RawPicFieldsWithNotify,
  positionalBack: {},
  fieldObjectClass: CubeField,
  fieldsObjectClass: CubeFields,
  firstFieldOffset: 0,
};
export const RawMucFieldDefinition: FieldDefinition = {
  fieldNames: CubeFieldType,
  fieldLengths: CubeFieldLength,
  positionalFront: RawMucFields,
  positionalBack: {},
  fieldObjectClass: CubeField,
  fieldsObjectClass: CubeFields,
  firstFieldOffset: 0,
};
export const RawMucFieldDefinitionWithNotify: FieldDefinition = {
  fieldNames: CubeFieldType,
  fieldLengths: CubeFieldLength,
  positionalFront: RawMucFieldsWithNotify,
  positionalBack: {},
  fieldObjectClass: CubeField,
  fieldsObjectClass: CubeFields,
  firstFieldOffset: 0,
};
export const RawPmucFieldDefinition: FieldDefinition = {
  fieldNames: CubeFieldType,
  fieldLengths: CubeFieldLength,
  positionalFront: RawPmucFields,
  positionalBack: {},
  fieldObjectClass: CubeField,
  fieldsObjectClass: CubeFields,
  firstFieldOffset: 0,
};
export const RawPmucFieldDefinitionWithNotify: FieldDefinition = {
  fieldNames: CubeFieldType,
  fieldLengths: CubeFieldLength,
  positionalFront: RawPmucFieldsWithNotify,
  positionalBack: {},
  fieldObjectClass: CubeField,
  fieldsObjectClass: CubeFields,
  firstFieldOffset: 0,
};

// Predefined FieldParser instances for the raw Cube family
export const rawFrozenParser: FieldParser = new FieldParser(RawFrozenFieldDefinition);
export const rawFrozenWithNotifyParser: FieldParser = new FieldParser(RawFrozenFieldDefinitionWithNotify);
export const rawPicParser: FieldParser = new FieldParser(RawPicFieldDefinition);
export const rawPicWithNotifyParser: FieldParser = new FieldParser(RawPicFieldDefinitionWithNotify);
export const rawMucParser: FieldParser = new FieldParser(RawMucFieldDefinition);
export const rawMucWithNotifyParser: FieldParser = new FieldParser(RawMucFieldDefinitionWithNotify);
export const rawPmucParser: FieldParser = new FieldParser(RawPmucFieldDefinition);
export const rawPmucWithNotifyParser: FieldParser = new FieldParser(RawPmucFieldDefinitionWithNotify);

// FieldParserTable for the raw Cube family
export const rawFieldParsers: FieldParserTable = {
  [CubeType.FROZEN]: rawFrozenParser,
  [CubeType.FROZEN_NOTIFY]: rawFrozenWithNotifyParser,
  [CubeType.PIC]: rawPicParser,
  [CubeType.PIC_NOTIFY]: rawPicWithNotifyParser,
  [CubeType.MUC]: rawMucParser,
  [CubeType.MUC_NOTIFY]: rawMucWithNotifyParser,
  [CubeType.PMUC]: rawPmucParser,
  [CubeType.PMUC_NOTIFY]: rawPmucWithNotifyParser,
}
// rawCubeFamily itself defined in cube.ts as, again, Javascript is annoying
