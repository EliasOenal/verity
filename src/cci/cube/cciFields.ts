import { NetConstants } from "../../core/networking/networkDefinitions";

import { FieldPosition } from "../../core/fields/baseFields";
import { CubeField } from "../../core/cube/cubeField";
import { CubeFields, FieldParserTable } from "../../core/cube/cubeFields";
import { FieldDefinition, FieldParser } from "../../core/fields/fieldParser";
import { CubeType, FrozenDefaultFields, FrozenNotifyDefaultFields, FrozenNotifyPositionalBack, FrozenPositionalBack, FrozenPositionalFront, MucDefaultFields, MucNotifyDefaultFields, MucNotifyPositionalBack, MucPositionalBack, MucPositionalFront, PicDefaultFields, PicNotifyDefaultFields, PicNotifyPositionalBack, PicPositionalBack, PicPositionalFront, PmucDefaultFields, PmucNotifyDefaultFields, PmucNotifyPositionalBack, PmucPositionalBack, PmucPositionalFront } from "../../core/cube/cube.definitions";

import { cciFieldType, cciFieldLength } from "./cciCube.definitions";
import { cciField } from "./cciField";
import { cciRelationship } from "./cciRelationship";

import { Buffer } from 'buffer'
import { logger } from "../../core/logger";

/**
 * A cciFields object is a wrapper object for the list of fields contained
 * in a CCI-compliant Cube.
 */
export class cciFields extends CubeFields {
  static Frozen(
    data: CubeFields | CubeField[] | CubeField = [],
    fieldDefinition: FieldDefinition = cciFrozenFieldDefinition
  ): cciFields {
    return super.Frozen(data, fieldDefinition) as cciFields;
  }

  static Muc(
    publicKey: Buffer | Uint8Array,
    data: CubeFields | CubeField[] | CubeField = [],
    fieldDefinition: FieldDefinition = cciMucFieldDefinition
  ): cciFields {
    return super.Muc(publicKey, data, fieldDefinition) as cciFields;
  }

  constructor(
      data: cciFields | Array<cciField> | cciField | undefined,
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
      if (type === undefined || relationship.type === type) ret.push(relationship);
    }
    return ret;
  }


  public getFirstRelationship(type?: number): cciRelationship {
    const rels: Array<cciRelationship> = this.getRelationships(type);
    if (rels.length) return rels[0];
    else return undefined;
  }

  /**
   * Adds additional fields until either supplied fields have been added or
   * there's no space left in the Cube.
   * @param fields An iterable of CubeFields, e.g. an Array or a Generator.
   * @returns The number of fields inserted.
   */
  insertTillFull(
      fields: Iterable<CubeField>,
      position: FieldPosition = FieldPosition.BEFORE_BACK_POSITIONALS,
  ): number {
    let inserted = 0;
    for (const field of fields) {
      const spaceRemaining = this.bytesRemaining();
      const spaceRequired = field.length +
        FieldParser.getFieldHeaderLength(field.type, this.fieldDefinition);
      if (spaceRemaining < spaceRequired) break;
      this.insertField(position, field);
      // logger.trace(`cciFields.insertTillFull(): Inserted ${field}`);
      inserted++;
    }
    return inserted;
  }

}

// NOTE: Never move this to another file. This only works if it is defined
// strictly after cciField and cciFields.
// For the same reason, cciFamily is defined in the same file as cciCube.
// Javascript is crazy.
export const cciFrozenFieldDefinition: FieldDefinition = {
  fieldNames: cciFieldType,
  fieldLengths: cciFieldLength,
  positionalFront: FrozenPositionalFront,
  positionalBack: FrozenPositionalBack,
  fieldObjectClass: cciField,
  fieldsObjectClass: cciFields,
  defaultField: FrozenDefaultFields,
  stopField: cciFieldType.CCI_END,
  remainderField: cciFieldType.REMAINDER,
};
export const cciFrozenNotifyFieldDefinition: FieldDefinition = {
  fieldNames: cciFieldType,
  fieldLengths: cciFieldLength,
  positionalFront: FrozenPositionalFront,
  positionalBack: FrozenNotifyPositionalBack,
  fieldObjectClass: cciField,
  fieldsObjectClass: cciFields,
  defaultField: FrozenNotifyDefaultFields,
  stopField: cciFieldType.CCI_END,
  remainderField: cciFieldType.REMAINDER,
};
export const cciPicFieldDefinition: FieldDefinition = {
  fieldNames: cciFieldType,
  fieldLengths: cciFieldLength,
  positionalFront: PicPositionalFront,
  positionalBack: PicPositionalBack,
  fieldObjectClass: cciField,
  fieldsObjectClass: cciFields,
  defaultField: PicDefaultFields,
  stopField: cciFieldType.CCI_END,
  remainderField: cciFieldType.REMAINDER,
};
export const cciPicNotifyFieldDefinition: FieldDefinition = {
  fieldNames: cciFieldType,
  fieldLengths: cciFieldLength,
  positionalFront: PicPositionalFront,
  positionalBack: PicNotifyPositionalBack,
  fieldObjectClass: cciField,
  fieldsObjectClass: cciFields,
  defaultField: PicNotifyDefaultFields,
  stopField: cciFieldType.CCI_END,
  remainderField: cciFieldType.REMAINDER,
};
export const cciMucFieldDefinition: FieldDefinition = {
  fieldNames: cciFieldType,
  fieldLengths: cciFieldLength,
  positionalFront: MucPositionalFront,
  positionalBack: MucPositionalBack,
  fieldObjectClass: cciField,
  fieldsObjectClass: cciFields,
  defaultField: MucDefaultFields,
  stopField: cciFieldType.CCI_END,
  remainderField: cciFieldType.REMAINDER,
};
export const cciMucNotifyFieldDefinition: FieldDefinition = {
  fieldNames: cciFieldType,
  fieldLengths: cciFieldLength,
  positionalFront: MucPositionalFront,
  positionalBack: MucNotifyPositionalBack,
  fieldObjectClass: cciField,
  fieldsObjectClass: cciFields,
  defaultField: MucNotifyDefaultFields,
  stopField: cciFieldType.CCI_END,
  remainderField: cciFieldType.REMAINDER,
};
export const cciPmucFieldDefinition: FieldDefinition = {
  fieldNames: cciFieldType,
  fieldLengths: cciFieldLength,
  positionalFront: PmucPositionalFront,
  positionalBack: PmucPositionalBack,
  fieldObjectClass: cciField,
  fieldsObjectClass: cciFields,
  defaultField: PmucDefaultFields,
  stopField: cciFieldType.CCI_END,
  remainderField: cciFieldType.REMAINDER,
};
export const cciPmucNotifyFieldDefinition: FieldDefinition = {
  fieldNames: cciFieldType,
  fieldLengths: cciFieldLength,
  positionalFront: PmucPositionalFront,
  positionalBack: PmucNotifyPositionalBack,
  fieldObjectClass: cciField,
  fieldsObjectClass: cciFields,
  defaultField: PmucNotifyDefaultFields,
  stopField: cciFieldType.CCI_END,
  remainderField: cciFieldType.REMAINDER,
};
export const cciFrozenParser: FieldParser = new FieldParser(cciFrozenFieldDefinition);
export const cciFrozenNotifyParser: FieldParser = new FieldParser(cciFrozenNotifyFieldDefinition);
export const cciPicParser: FieldParser = new FieldParser(cciPicFieldDefinition);
export const cciPicNotifyParser: FieldParser = new FieldParser(cciPicNotifyFieldDefinition);
export const cciMucParser: FieldParser = new FieldParser(cciMucFieldDefinition);
export const cciMucNotifyParser: FieldParser = new FieldParser(cciMucNotifyFieldDefinition);
export const cciPmucParser: FieldParser = new FieldParser(cciPmucFieldDefinition);
export const cciPmucNotifyParser: FieldParser = new FieldParser(cciPmucNotifyFieldDefinition);

export const cciFieldParsers: FieldParserTable = {
  [CubeType.FROZEN]: cciFrozenParser,
  [CubeType.FROZEN_NOTIFY]: cciFrozenNotifyParser,
  [CubeType.PIC]: cciPicParser,
  [CubeType.PIC_NOTIFY]: cciPicNotifyParser,
  [CubeType.MUC]: cciMucParser,
  [CubeType.MUC_NOTIFY]: cciMucNotifyParser,
  [CubeType.PMUC]: cciPmucParser,
  [CubeType.PMUC_NOTIFY]: cciPmucNotifyParser,
}
