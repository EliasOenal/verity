import { NetConstants } from "../networking/networkDefinitions";

import { BaseFields, FieldPosition } from "../fields/baseFields";
import { PositionalFields, FieldDefinition, FieldParser } from "../fields/fieldParser";

import { CubeType } from "./cubeDefinitions";
import type { Cube } from "./cube";
import { CubeFieldType, CubeField, CubeFieldLength } from "./cubeField";

import { Buffer } from 'buffer';

/**
 * For positional fields, defines the running order this field must be at.
 * It follows that positional fields are both mandatory and can only occur once.
 * This section defines the positional fields for our four cube types.
 * Note: The current implementation requires positional fields to be at the very
 * beginning.
 * Note: In the current implementation, positional fields MUST have a defined length.
 * Note: Numbering starts at 1 (not 0).
 */
export const frozenPositionalFront: PositionalFields = {
  1: CubeFieldType.TYPE,
};
export const frozenPositionalBack: PositionalFields = {
  1: CubeFieldType.NONCE,
  2: CubeFieldType.DATE,
}

export const mucPositionalFront: PositionalFields = frozenPositionalFront;  // no difference before payload
export const mucPositionalBack: PositionalFields = {
  1: CubeFieldType.NONCE,
  2: CubeFieldType.SIGNATURE,
  3: CubeFieldType.DATE,
  4: CubeFieldType.PUBLIC_KEY,
}
export const mucPositionalBackWithNotify: PositionalFields = {
  1: CubeFieldType.NONCE,
  2: CubeFieldType.SIGNATURE,
  3: CubeFieldType.DATE,
  4: CubeFieldType.PUBLIC_KEY,
  5: CubeFieldType.NOTIFY,
}

export const pmucPositionalFront: PositionalFields = frozenPositionalFront;  // no difference to Frozen Cubes
export const pmucPositionalBack: PositionalFields = {
  1: CubeFieldType.NONCE,
  2: CubeFieldType.SIGNATURE,
  3: CubeFieldType.DATE,
  4: CubeFieldType.PUBLIC_KEY,
  5: CubeFieldType.PMUC_UPDATE_COUNT,
}
export const pmucPositionalBackWithNotify: PositionalFields = {
  1: CubeFieldType.NONCE,
  2: CubeFieldType.SIGNATURE,
  3: CubeFieldType.DATE,
  4: CubeFieldType.PUBLIC_KEY,
  5: CubeFieldType.PMUC_UPDATE_COUNT,
  6: CubeFieldType.NOTIFY,
}


export class CubeFields extends BaseFields {
  /**
   * Helper function to create a valid frozen cube field set for you.
   * Just supply your payload fields and we'll take care of the rest.
   * You can also go a step further and just use Cube.Frozen() for even more
   * convenience, which will then in turn call us.
   **/
  static Frozen(
      data: CubeFields | CubeField[] | CubeField = undefined,
      fieldDefinition: FieldDefinition = coreFrozenFieldDefinition
  ): CubeFields {
    if (data instanceof CubeField) data = [data];
    if (data instanceof CubeFields) data = data.all;
    const fields: CubeFields =
      new fieldDefinition.fieldsObjectClass(data, fieldDefinition);

    fields.ensureFieldInFront(CubeFieldType.TYPE,
      fieldDefinition.fieldObjectClass.Type(CubeType.FROZEN));
    fields.ensureFieldInBack(CubeFieldType.DATE,
      fieldDefinition.fieldObjectClass.Date());
    fields.ensureFieldInBack(CubeFieldType.NONCE,
      fieldDefinition.fieldObjectClass.Nonce());

    // logger.trace("CubeFields.Frozen() creates this field set for a frozen Cube: " + fields.toLongString());
    return fields;
  }

  /**
   * Helper function to create a valid MUC field set for you.
   * Just supply your payload fields and we'll take care of the rest.
   * You can also go a step further and just use Cube.MUC() for even more
   * convenience, which will then in turn call us.
   **/
  static Muc(
      publicKey: Buffer | Uint8Array,
      data: CubeFields | CubeField[] | CubeField = undefined,
      fieldDefinition: FieldDefinition = coreMucFieldDefinition
  ): CubeFields {
    // input normalization
    if (data instanceof CubeField) data = [data];
    if (data instanceof CubeFields) data = data.all;
    if (!(publicKey instanceof Buffer)) publicKey = Buffer.from(publicKey);
    const fields: CubeFields =
      new fieldDefinition.fieldsObjectClass(data, fieldDefinition);

    fields.ensureFieldInFront(CubeFieldType.TYPE,
      fieldDefinition.fieldObjectClass.Type(CubeType.MUC));
    fields.ensureFieldInBack(CubeFieldType.PUBLIC_KEY,
      fieldDefinition.fieldObjectClass.PublicKey(publicKey));
    fields.ensureFieldInBack(CubeFieldType.DATE,
      fieldDefinition.fieldObjectClass.Date());
    fields.ensureFieldInBack(CubeFieldType.SIGNATURE,
      fieldDefinition.fieldObjectClass.Signature());
    fields.ensureFieldInBack(CubeFieldType.NONCE,
      fieldDefinition.fieldObjectClass.Nonce());

    // logger.trace("CubeFields.Muc() creates this field set for a MUC: " + fields.toLongString());
    return fields;
  }

  bytesRemaining(max: number = NetConstants.CUBE_SIZE): number {
    return max - this.getByteLength();
  }

  /**
   * Adds additional fields until either supplied fields have been added or
   * there's no space left in the Cube.
   * @param fields An iterable of CubeFields, e.g. an Array or a Generator.
   * @returns The number of fields inserted.
   */
  insertTillFull(
      fields: Iterable<CubeField>,
      position: FieldPosition = FieldPosition.BEFORE_BACK_POSITIONALS): number {
    let inserted = 0;
    for (const field of fields) {
      const spaceRemaining = this.bytesRemaining();
      const spaceRequired = field.length +
        FieldParser.getFieldHeaderLength(field.type, this.fieldDefinition);
      if (spaceRemaining < spaceRequired) break;
      this.insertField(field, position);
      inserted++;
    }
    return inserted;
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
// positional fields, discarding all TLV information.
// This is how forwarding-only, "server" nodes parse Cubes as they just
// don't care about their contents.

// NOTE: Never move any this to another file. This only works if it is defined
// strictly after CubeField. If you move it somewhere else, it's basically
// random whether it works or you get random undefined values in code
// coming from some files (but not others).
// Javascript is crazy.

// TODO: get rid of those, use the raw field definitions (which include the core
// payload field) instead
export const coreFrozenFieldDefinition: FieldDefinition = {
  fieldNames: CubeFieldType,
  fieldLengths: CubeFieldLength,
  positionalFront: frozenPositionalFront,
  positionalBack: frozenPositionalBack,
  fieldObjectClass: CubeField,
  fieldsObjectClass: CubeFields,
  firstFieldOffset: 0,
}
export const coreMucFieldDefinition: FieldDefinition = {
  fieldNames: CubeFieldType,
  fieldLengths: CubeFieldLength,
  positionalFront: mucPositionalFront,
  positionalBack: mucPositionalBack,
  fieldObjectClass: CubeField,
  fieldsObjectClass: CubeFields,
  firstFieldOffset: 0,
}

/**
 * The (singleton) FieldParser for standard, "frozen" cubes, supporting
 * core fields only.
 * Applications will need to create their own FieldParser(s) for any
 * custom/payload fields they might want to use.
 * CCI provides an optional interface for this.
 */
export const coreFrozenParser: FieldParser = new FieldParser(coreFrozenFieldDefinition);
coreFrozenParser.decompileTlv = false;  // core-only nodes ignore TLV

/**
 * The (singleton) FieldParser for standard, "frozen" cubes, supporting
 * core fields only.
 * Applications will need to create their own FieldParser(s) for any
 * custom/payload fields they might want to use.
 * CCI provides an optional interface for this.
 */
export const coreMucParser: FieldParser = new FieldParser(coreMucFieldDefinition);
coreMucParser.decompileTlv = false;  // core-only nodes ignore TLV

export const coreFieldParsers: FieldParserTable = {
  [CubeType.FROZEN]: coreFrozenParser,
  [CubeType.MUC]: coreMucParser,
}
// coreCubeFamily itself defined in cube.ts as, again, Javascript is annoying

// Core TLV Cube family -- for testing only, please use CCI instead
export const coreTlvFrozenParser: FieldParser = new FieldParser(coreFrozenFieldDefinition);
export const coreTlvMucParser: FieldParser = new FieldParser(coreMucFieldDefinition);
export const coreTlvFieldParsers: FieldParserTable = {
  [CubeType.FROZEN]: coreTlvFrozenParser,
  [CubeType.MUC]: coreTlvMucParser,
}
// coreTlvCubeFamily itself defined in cube.ts as, again, Javascript is annoying
