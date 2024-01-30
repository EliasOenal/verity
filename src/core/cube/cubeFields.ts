import { unixtime } from "../helpers";
import { Settings } from "../settings";

import { BaseField, BaseRelationship, BaseFields } from "./baseFields";

import { FieldNumericalParam, PositionalFields, FieldDefinition, FieldParser } from "../fieldParser";
import { NetConstants, NetworkError } from "../networking/networkDefinitions";

import { Buffer } from 'buffer';
import { CubeType, FieldError } from "./cubeDefinitions";
import { logger } from "../logger";

/**
 * Core field definitions.
 * These are used for the FieldParser in the core library.
 * Applications will usually supplement this with their own sub-field structure;
 * our CCI layer provides an optional framework for doing this.
 */
export enum CubeFieldType {
  // Positional fields, listed in order of appearance for ease of reference.
  // Includes all positional fields for all cube types; obviously, different
  // types of cubes will use and omit different fields.
  // Assigned ID is for local purposes only as these are positionals, not TLV.
  TYPE = 1001,

  // CCI/payload fields inserted here

  // NOTIFY = 2001, not implemented yet
  // PMUC_UPDATE_COUNT = 2002, not implemented yet
  PUBLIC_KEY = 2003,
  DATE = 2004,
  SIGNATURE = 2005,
  NONCE = 2006,

  PAYLOAD = 1 << 2,  // 4 -- core payload field mainly for testing, architecturally this belongs to the CCI layer
  PADDING = 2 << 2,  // 8
  PADDING_SINGLEBYTE = 3 << 2,

  // TODO move to CCI
  /**
  * Seed used to derive a new key pair for an extension MUC.
  * Note that this should not actually be public information as it's only needed
  * by the author to derive their private key from their master key.
  * We're still putting it right into the MUC out of convenience and due to
  * the fact that this information must be available somewhere on the network
  * for Identity recovery ("password-based login").
  * We're pretty confident this does not actually expose any cryptographically
  * sensitive information, but we maybe should encrypt it.
  */
  SUBKEY_SEED = 0x09 << 2,
}

export const CubeFieldLength: FieldNumericalParam = {
  [CubeFieldType.TYPE]: NetConstants.CUBE_TYPE_SIZE,
  // NOTIFY not implemented yet
  // PMUC_UPDATE_COUNT not implemented yet
  [CubeFieldType.PUBLIC_KEY]: NetConstants.PUBLIC_KEY_SIZE,
  [CubeFieldType.DATE]: NetConstants.TIMESTAMP_SIZE,
  [CubeFieldType.SIGNATURE]: NetConstants.SIGNATURE_SIZE + NetConstants.FINGERPRINT_SIZE,
  [CubeFieldType.NONCE]: Settings.NONCE_SIZE,
  [CubeFieldType.PAYLOAD]: undefined,
  [CubeFieldType.PADDING]: undefined,
  [CubeFieldType.PADDING_SINGLEBYTE]: 1,
  [CubeFieldType.SUBKEY_SEED]: undefined,  // TODO move to CCI
};

/**
 * For positional fields, defines the running order this field must be at.
 * It follows that positional fields are both mandatory and can only occur once.
 * This section defines the positional fields for our four cube types.
 * Note: The current implementation requires positional fields to be at the very
 * beginning.
 * Note: In the current implementation, positional fields MUST have a defined length.
 * Note: Numbering starts at 1 (not 0).
 */
const dumbPositionalFront: PositionalFields = {
  1: CubeFieldType.TYPE,
};
const dumbPositionalBack: PositionalFields = {
  1: CubeFieldType.NONCE,
  2: CubeFieldType.DATE,
}
const mucPositionalFront: PositionalFields = dumbPositionalFront;  // no difference before payload
const mucPositionalBack: PositionalFields = {
  1: CubeFieldType.NONCE,
  2: CubeFieldType.SIGNATURE,
  3: CubeFieldType.DATE,
  4: CubeFieldType.PUBLIC_KEY,
}

export class CubeField extends BaseField {
  static TypeField(cubeType: CubeType): CubeField {
    const typeFieldBuf: Buffer = Buffer.alloc(CubeFieldLength[CubeFieldType.TYPE]);
    typeFieldBuf.writeUIntBE(cubeType, 0, CubeFieldLength[CubeFieldType.TYPE]);
    return new CubeField(
      CubeFieldType.TYPE, CubeFieldLength[CubeFieldType.TYPE], typeFieldBuf);
  }

  static DateField(cubeDate: number = unixtime()): CubeField {
    const dateFieldBuf: Buffer = Buffer.alloc(CubeFieldLength[CubeFieldType.DATE]);
    dateFieldBuf.writeUIntBE(cubeDate, 0, CubeFieldLength[CubeFieldType.DATE]);
    return new CubeField(
      CubeFieldType.DATE, CubeFieldLength[CubeFieldType.DATE], dateFieldBuf);
  }

  static NonceField(): CubeField {
    const random_bytes = new Uint8Array(Settings.NONCE_SIZE);
    for (let i = 0; i < Settings.NONCE_SIZE; i++) {
      random_bytes[i] = Math.floor(Math.random() * 256);
    }
    return new CubeField(
      CubeFieldType.NONCE,
      CubeFieldLength[CubeFieldType.NONCE],
      Buffer.from(random_bytes));
  }

  /**
   * Will return a PADDING field if requested length is > 1 or the special
   * PADDING_SINGLEBYTE field for the length==1 edge case.
  */
  static PaddingField(length: number): CubeField {
    let field: CubeField;
    if (length > 1) {
      const random_bytes = new Uint8Array(length-2);
      for (let i = 0; i < length-2; i++) {
        random_bytes[i] = Math.floor(Math.random() * 256);
      }
      field = new CubeField(
        CubeFieldType.PADDING, length-2,
        Buffer.from(random_bytes));
    } else {
      field = new CubeField(
        CubeFieldType.PADDING_SINGLEBYTE, 1,
        Buffer.alloc(1, Math.floor(Math.random()*256)));
    }
    return field;
  }

  static PublicKeyField(publicKey: Buffer): CubeField {
    return new CubeField(
      CubeFieldType.PUBLIC_KEY,
      NetConstants.PUBLIC_KEY_SIZE,
      publicKey as Buffer);
  }

  static SignatureField(): CubeField {
    return new CubeField(
      CubeFieldType.SIGNATURE,
      CubeFieldLength[CubeFieldType.SIGNATURE],
      Buffer.alloc(CubeFieldLength[CubeFieldType.SIGNATURE]));
  }

  // Actual payloads should use CCI fields, this is mainly for testing
  static PayloadField(buf: Buffer | string) {
    if (typeof buf === 'string' || buf instanceof String)  {
        buf = Buffer.from(buf, 'utf-8');
    }
    return new CubeField(CubeFieldType.PAYLOAD, buf.length, buf);
  }

  // TODO move to CCI
  static SubkeySeed(buf: Buffer | Uint8Array): CubeField {
    if (!(buf instanceof Buffer)) buf = Buffer.from(buf);
    return new CubeField(CubeFieldType.SUBKEY_SEED, buf.length, buf as Buffer);
  }
}

export class CubeFields extends BaseFields {
  /**
   * Helper function to create a valid dumb cube field set for you.
   * Just supply your payload fields and we'll take care of the rest.
   * You can also go a step further and just use Cube.Dumb() for even more
   * convenience, which will then in turn call us.
   **/
  static DumbFields(data: CubeFields | CubeField[] | CubeField = []): CubeFields {
    if (data instanceof CubeField) data = [data];
    if (data instanceof CubeFields) data = data.all;
    const fields = new CubeFields(data, dumbFieldDefinition);

    // Create TYPE (type, version, feature bits) field
    if (Settings.RUNTIME_ASSERTIONS && fields.getFirst(CubeFieldType.TYPE) !== undefined) {
      throw new FieldError("CubeFields.DumbFields(): Cannot auto-create mandatory fields as TYPE field already exists");
    }
    fields.insertFieldInFront(CubeField.TypeField(CubeType.DUMB));

    // Create DATE field
    if (Settings.RUNTIME_ASSERTIONS && fields.getFirst(CubeFieldType.DATE) !== undefined) {
      throw new FieldError("CubeFields.DumbFields(): Cannot auto-create mandatory fields as DATE field already exists");
    }
    fields.appendField(CubeField.DateField());

    // Create randomized NONCE field
    if (Settings.RUNTIME_ASSERTIONS && fields.getFirst(CubeFieldType.NONCE) !== undefined) {
      throw new FieldError("CubeFields.DumbFields(): Cannot auto-create mandatory fields as NONCE field already exists");
    }
    fields.appendField(CubeField.NonceField());
    // logger.trace("CubeFields.DumbFields() creates this field set for a dumb Cube: " + fields.toLongString());
    return fields;
  }

  /**
   * Helper function to create a valid MUC field set for you.
   * Just supply your payload fields and we'll take care of the rest.
   * You can also go a step further and just use Cube.Dumb() for even more
   * convenience, which will then in turn call us.
   **/
  static MucFields(
      publicKey: Buffer | Uint8Array,
      data: CubeFields | CubeField[] | CubeField = [],
  ): CubeFields {
    // input normalization
    if (data instanceof CubeField) data = [data];
    if (data instanceof CubeFields) data = data.all;
    if (!(publicKey instanceof Buffer)) publicKey = Buffer.from(publicKey);

    const fields = new CubeFields(data, mucFieldDefinition);

    // Create TYPE (type, version, feature bits) field
    if (Settings.RUNTIME_ASSERTIONS && fields.getFirst(CubeFieldType.TYPE) !== undefined) {
      throw new FieldError("CubeFields.MucFields(): Cannot auto-create mandatory fields as TYPE field already exists");
    }
    fields.insertFieldInFront(CubeField.TypeField(CubeType.MUC));

    // Create PUBLIC_KEY field
    if (Settings.RUNTIME_ASSERTIONS && fields.getFirst(CubeFieldType.PUBLIC_KEY) !== undefined) {
      throw new FieldError("CubeFields.MucFields(): Cannot auto-create mandatory fields as PUBLIC_KEY field them already exists");
    }
    fields.appendField(CubeField.PublicKeyField(publicKey as Buffer));

    // Create DATE field
    if (Settings.RUNTIME_ASSERTIONS && fields.getFirst(CubeFieldType.DATE) !== undefined) {
      throw new FieldError("CubeFields.MucFields(): Cannot auto-create mandatory fields as DATE field them already exists");
    }
    fields.appendField(CubeField.DateField());

    // Create SIGNATURE field
    if (Settings.RUNTIME_ASSERTIONS && fields.getFirst(CubeFieldType.SIGNATURE) !== undefined) {
      throw new FieldError("CubeFields.MucFields(): Cannot auto-create mandatory fields as SIGNATURE field already exists");
    }
    fields.appendField(CubeField.SignatureField());

    // Create randomized NONCE field
    if (Settings.RUNTIME_ASSERTIONS && fields.getFirst(CubeFieldType.NONCE) !== undefined) {
      throw new FieldError("CubeFields.MucFields(): Cannot auto-create mandatory fields as NONCE field already exists");
    }
    fields.appendField(CubeField.NonceField());

    return fields;
  }
}

// NOTE: Never move this to another file. This only works if it is defined
// strictly after CubeField. If you move it somewhere else, it's basically
// random whether it works or not and you can random undefined values in code
// coming from some files (but not others).
// Javascript is crazy.
export const dumbFieldDefinition: FieldDefinition = {
  fieldNames: CubeFieldType,
  fieldLengths: CubeFieldLength,
  positionalFront: dumbPositionalFront,
  positionalBack: dumbPositionalBack,
  fieldObjectClass: CubeField,
  fieldsObjectClass: CubeFields,
  firstFieldOffset: 0,
}
export const mucFieldDefinition: FieldDefinition = {
  fieldNames: CubeFieldType,
  fieldLengths: CubeFieldLength,
  positionalFront: mucPositionalFront,
  positionalBack: mucPositionalBack,
  fieldObjectClass: CubeField,
  fieldsObjectClass: CubeFields,
  firstFieldOffset: 0,
}

export const cubeDefinition = {};  // lookup table
cubeDefinition[CubeType.DUMB] = dumbFieldDefinition;
cubeDefinition[CubeType.MUC] = mucFieldDefinition;

/**
 * The (singleton) FieldParser for standard, "dumb" cubes, supporting
 * core fields only.
 * Applications will need to create their own FieldParser(s) for any
 * custom/payload fields they might want to use.
 * CCI provides an optional interface for this.
 */
export const coreDumbParser: FieldParser = new FieldParser(dumbFieldDefinition);
coreDumbParser.decompileTlv = false;  // core-only nodes ignore TLV

/**
 * The (singleton) FieldParser for standard, "dumb" cubes, supporting
 * core fields only.
 * Applications will need to create their own FieldParser(s) for any
 * custom/payload fields they might want to use.
 * CCI provides an optional interface for this.
 */
export const coreMucParser: FieldParser = new FieldParser(mucFieldDefinition);
coreMucParser.decompileTlv = false;  // core-only nodes ignore TLV

export interface FieldParserTable {
  [n: number]: FieldParser;
}

export const coreFieldParsers: FieldParserTable = {} // lookup table
coreFieldParsers[CubeType.DUMB] = coreDumbParser;
coreFieldParsers[CubeType.MUC] = coreMucParser;

// a set of TLV-enabled parsers for testing
export const coreTlvDumbParser: FieldParser = new FieldParser(dumbFieldDefinition);
export const coreTlvMucParser: FieldParser = new FieldParser(mucFieldDefinition);
export const coreTlvFieldParsers: FieldParserTable = {}
coreTlvFieldParsers[CubeType.DUMB] = coreTlvDumbParser;
coreTlvFieldParsers[CubeType.MUC] = coreTlvMucParser;
