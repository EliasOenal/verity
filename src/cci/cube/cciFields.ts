import { CubeFields, FieldParserTable } from "../../core/cube/cubeFields";
import { FieldDefinition, FieldParser } from "../../core/fields/fieldParser";
import { CubeType, FrozenPositionalBack, FrozenPositionalFront, MucPositionalBack, MucPositionalFront } from "../../core/cube/cube.definitions";
import { cciField, cciFieldType, cciFieldLength } from "./cciField";
import { cciRelationship } from "./cciRelationship";

import { Buffer } from 'buffer'
import { CubeField } from "../../core/cube/cubeField";

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
      if (type === undefined || relationship.type === type) ret.push(relationship);
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
// strictly after cciField and cciFields.
// Javascript is crazy.
export const cciFrozenFieldDefinition: FieldDefinition = {
  fieldNames: cciFieldType,
  fieldLengths: cciFieldLength,
  positionalFront: FrozenPositionalFront,
  positionalBack: FrozenPositionalBack,
  fieldObjectClass: cciField,
  fieldsObjectClass: cciFields,
  stopField: cciFieldType.CCI_END,
  remainderField: cciFieldType.REMAINDER,
}
export const cciMucFieldDefinition: FieldDefinition = {
  fieldNames: cciFieldType,
  fieldLengths: cciFieldLength,
  positionalFront: MucPositionalFront,
  positionalBack: MucPositionalBack,
  fieldObjectClass: cciField,
  fieldsObjectClass: cciFields,
  stopField: cciFieldType.CCI_END,
  remainderField: cciFieldType.REMAINDER,
}
export const cciFrozenParser: FieldParser = new FieldParser(cciFrozenFieldDefinition);
export const cciMucParser: FieldParser = new FieldParser(cciMucFieldDefinition);

export const cciFieldParsers: FieldParserTable = {
  [CubeType.FROZEN]: cciFrozenParser,
  [CubeType.MUC]: cciMucParser,
}
