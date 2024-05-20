import { Settings } from '../settings';
import { NetConstants } from '../networking/networkDefinitions';
import { unixtime } from '../helpers/misc';

import { BaseField } from '../fields/baseField';
import { FieldNumericalParam } from '../fields/fieldParser';
import { CubeType, FieldError } from './cubeDefinitions';

import { Buffer } from 'buffer';
import { coreFrozenParser } from './cubeFields';

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
  // NOTIFY = 2001, not implemented yet
  // PMUC_UPDATE_COUNT = 2002, not implemented yet
  PUBLIC_KEY = 2003,
  DATE = 2004,
  SIGNATURE = 2005,
  NONCE = 2006,

  // HACKHACK: CCI field types PAYLOAD, PADDING and CCI_END currently defined on
  // core layer as we use them within core unit tests.
  CCI_END = 0x00 << 2,  // 0
  PAYLOAD = 0x10 << 2,  // 64
  PADDING = 0x1F << 2,  // 124

  RAWFROZEN = 3001,  // only used for alternate family parsing
  RAWMUC = 3002,  // only used for alternate family parsing
}

export const CubeFieldLength: FieldNumericalParam = {
  [CubeFieldType.TYPE]: NetConstants.CUBE_TYPE_SIZE,
  // NOTIFY not implemented yet
  // PMUC_UPDATE_COUNT not implemented yet
  [CubeFieldType.PUBLIC_KEY]: NetConstants.PUBLIC_KEY_SIZE,
  [CubeFieldType.DATE]: NetConstants.TIMESTAMP_SIZE,
  [CubeFieldType.SIGNATURE]: NetConstants.SIGNATURE_SIZE,
  [CubeFieldType.NONCE]: Settings.NONCE_SIZE,
  [CubeFieldType.PAYLOAD]: undefined,
  [CubeFieldType.PADDING]: undefined,
  [CubeFieldType.CCI_END]: 0,
  [CubeFieldType.RAWFROZEN]: NetConstants.CUBE_SIZE - NetConstants.CUBE_TYPE_SIZE - NetConstants.TIMESTAMP_SIZE - Settings.NONCE_SIZE,
  [CubeFieldType.RAWMUC]: NetConstants.CUBE_SIZE - NetConstants.CUBE_TYPE_SIZE - NetConstants.PUBLIC_KEY_SIZE - NetConstants.TIMESTAMP_SIZE - NetConstants.SIGNATURE_SIZE - Settings.NONCE_SIZE,
};

export class CubeField extends BaseField {
  static Type(cubeType: CubeType): CubeField {
    const typeFieldBuf: Buffer = Buffer.alloc(CubeFieldLength[CubeFieldType.TYPE]);
    typeFieldBuf.writeUIntBE(cubeType, 0, CubeFieldLength[CubeFieldType.TYPE]);
    return new this(CubeFieldType.TYPE, typeFieldBuf);
  }

  static Date(cubeDate: number = unixtime()): CubeField {
    const dateFieldBuf: Buffer = Buffer.alloc(CubeFieldLength[CubeFieldType.DATE]);
    dateFieldBuf.writeUIntBE(cubeDate, 0, CubeFieldLength[CubeFieldType.DATE]);
    return new this(CubeFieldType.DATE, dateFieldBuf);
  }

  static Nonce(): CubeField {
    const random_bytes = new Uint8Array(Settings.NONCE_SIZE);
    for (let i = 0; i < Settings.NONCE_SIZE; i++) {
      random_bytes[i] = Math.floor(Math.random() * 256);
    }
    return new this(
      CubeFieldType.NONCE,
      Buffer.from(random_bytes));
  }

  /**
   * Will return a PADDING field if requested length is > 1 or the special
   * PADDING_SINGLEBYTE field for the length==1 edge case.
  */
  // Architecturally, this belongs to cciField but it's defined here for
  // practical considerations
  static Padding(length: number): CubeField {
    let field: CubeField;
    if (length > 1) {
      const random_bytes = new Uint8Array(length-2);
      for (let i = 0; i < length - 2; i++) {  // maybe TODO: 2 is the header length of a variable size field and we should usually get this value from the field parser rather than littering literals throughout the code
        random_bytes[i] = Math.floor(Math.random() * 256);
      }
      field = new this(CubeFieldType.PADDING, Buffer.from(random_bytes));
    } else {
      field = new this(CubeFieldType.CCI_END, Buffer.alloc(0));
    }
    return field;
  }

  static PublicKey(publicKey: Buffer): CubeField {
    return new this(CubeFieldType.PUBLIC_KEY, publicKey as Buffer);
  }

  static Signature(): CubeField {
    return new this(
      CubeFieldType.SIGNATURE,
      Buffer.alloc(CubeFieldLength[CubeFieldType.SIGNATURE]));
  }

  // Architecturally, this belongs to cciField but it's defined here for
  // practical considerations
  static Payload(buf: Buffer | string, fieldClass = CubeField) {
    if (typeof buf === 'string' || buf instanceof String)  {
        buf = Buffer.from(buf, 'utf-8');
    }
    return new fieldClass(CubeFieldType.PAYLOAD, buf);
  }

  constructor(type: number, value: Buffer | string, start?: number) {
    if (Settings.RUNTIME_ASSERTIONS && CubeFieldLength[type] !== undefined &&
        value.length !== CubeFieldLength[type]) {
      throw new FieldError(`Cannot construct CubeField of type ${type} with length ${value.length}, spec prescribes length of ${CubeFieldLength[type]}`);
    }
    super(type, value, start);
  }
}
