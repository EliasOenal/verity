import type { CubeField } from "../../core/cube/cubeField";

import { FieldPosition } from "../../core/fields/baseFields";
import { CubeFields, FieldParserTable } from "../../core/cube/cubeFields";
import { FieldDefinition, FieldParser } from "../../core/fields/fieldParser";
import { CubeType, FrozenNotifyPositionalBack, FrozenPositionalBack, FrozenPositionalFront, MucNotifyPositionalBack, MucPositionalBack, MucPositionalFront, PicNotifyPositionalBack, PicPositionalBack, PicPositionalFront, PmucNotifyPositionalBack, PmucPositionalBack, PmucPositionalFront } from "../../core/cube/cube.definitions";
import { FrozenDefaultFields, FrozenNotifyDefaultFields, MucDefaultFields, MucNotifyDefaultFields, PicDefaultFields, PicNotifyDefaultFields, PmucDefaultFields, PmucNotifyDefaultFields } from "../../core/cube/cubeField";

import { FieldType, FieldLength } from "./cciCube.definitions";
import { VerityField } from "./verityField";
import { Relationship, RelationshipType } from "./relationship";

import { Buffer } from 'buffer'
import { logger } from "../../core/logger";

/**
 * A VerityFields object is a wrapper object for the list of fields contained
 * in a Veritum or CCI-compliant Cube.
 */
export class VerityFields extends CubeFields {
  static Frozen(
    data: CubeFields | CubeField[] | CubeField = [],
    fieldDefinition: FieldDefinition = cciFrozenFieldDefinition
  ): VerityFields {
    return super.Frozen(data, fieldDefinition) as VerityFields;
  }

  static Muc(
    publicKey: Buffer | Uint8Array,
    data: CubeFields | CubeField[] | CubeField = [],
    fieldDefinition: FieldDefinition = cciMucFieldDefinition
  ): VerityFields {
    return super.Muc(publicKey, data, fieldDefinition) as VerityFields;
  }

  // TODO do we need this empty constructor override?
  constructor(
      data: VerityFields | Array<VerityField> | VerityField | undefined,
      fieldDefinition: FieldDefinition) {
    super(data, fieldDefinition);
  }

  /**
  * Gets the relationships this cube has to other cubes, if any.
  * @param [type] If specified, only get relationships of the specified type.
  * @return An array of Relationship objects, which may be empty.
  */
  public getRelationships(type?: RelationshipType): Relationship[] {
    const relationshipfields = this.get(FieldType.RELATES_TO);
    const ret = [];
    for (const relationshipfield of relationshipfields) {
      const relationship: Relationship =
        Relationship.fromField(relationshipfield);
      if (type === undefined || relationship.type === type) ret.push(relationship);
    }
    return ret;
  }


  public getFirstRelationship(type?: RelationshipType): Relationship {
    const rels: Array<Relationship> = this.getRelationships(type);
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
  fieldNames: FieldType,
  fieldLengths: FieldLength,
  positionalFront: FrozenPositionalFront,
  positionalBack: FrozenPositionalBack,
  fieldObjectClass: VerityField,
  fieldsObjectClass: VerityFields,
  defaultField: FrozenDefaultFields,
  stopField: FieldType.CCI_END,
  remainderField: FieldType.REMAINDER,
};
export const cciFrozenNotifyFieldDefinition: FieldDefinition = {
  fieldNames: FieldType,
  fieldLengths: FieldLength,
  positionalFront: FrozenPositionalFront,
  positionalBack: FrozenNotifyPositionalBack,
  fieldObjectClass: VerityField,
  fieldsObjectClass: VerityFields,
  defaultField: FrozenNotifyDefaultFields,
  stopField: FieldType.CCI_END,
  remainderField: FieldType.REMAINDER,
};
export const cciPicFieldDefinition: FieldDefinition = {
  fieldNames: FieldType,
  fieldLengths: FieldLength,
  positionalFront: PicPositionalFront,
  positionalBack: PicPositionalBack,
  fieldObjectClass: VerityField,
  fieldsObjectClass: VerityFields,
  defaultField: PicDefaultFields,
  stopField: FieldType.CCI_END,
  remainderField: FieldType.REMAINDER,
};
export const cciPicNotifyFieldDefinition: FieldDefinition = {
  fieldNames: FieldType,
  fieldLengths: FieldLength,
  positionalFront: PicPositionalFront,
  positionalBack: PicNotifyPositionalBack,
  fieldObjectClass: VerityField,
  fieldsObjectClass: VerityFields,
  defaultField: PicNotifyDefaultFields,
  stopField: FieldType.CCI_END,
  remainderField: FieldType.REMAINDER,
};
export const cciMucFieldDefinition: FieldDefinition = {
  fieldNames: FieldType,
  fieldLengths: FieldLength,
  positionalFront: MucPositionalFront,
  positionalBack: MucPositionalBack,
  fieldObjectClass: VerityField,
  fieldsObjectClass: VerityFields,
  defaultField: MucDefaultFields,
  stopField: FieldType.CCI_END,
  remainderField: FieldType.REMAINDER,
};
export const cciMucNotifyFieldDefinition: FieldDefinition = {
  fieldNames: FieldType,
  fieldLengths: FieldLength,
  positionalFront: MucPositionalFront,
  positionalBack: MucNotifyPositionalBack,
  fieldObjectClass: VerityField,
  fieldsObjectClass: VerityFields,
  defaultField: MucNotifyDefaultFields,
  stopField: FieldType.CCI_END,
  remainderField: FieldType.REMAINDER,
};
export const cciPmucFieldDefinition: FieldDefinition = {
  fieldNames: FieldType,
  fieldLengths: FieldLength,
  positionalFront: PmucPositionalFront,
  positionalBack: PmucPositionalBack,
  fieldObjectClass: VerityField,
  fieldsObjectClass: VerityFields,
  defaultField: PmucDefaultFields,
  stopField: FieldType.CCI_END,
  remainderField: FieldType.REMAINDER,
};
export const cciPmucNotifyFieldDefinition: FieldDefinition = {
  fieldNames: FieldType,
  fieldLengths: FieldLength,
  positionalFront: PmucPositionalFront,
  positionalBack: PmucNotifyPositionalBack,
  fieldObjectClass: VerityField,
  fieldsObjectClass: VerityFields,
  defaultField: PmucNotifyDefaultFields,
  stopField: FieldType.CCI_END,
  remainderField: FieldType.REMAINDER,
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
