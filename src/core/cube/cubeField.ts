import { Settings } from '../settings';
import { NetConstants } from '../networking/networkDefinitions';
import { unixtime } from '../helpers';

import { BaseField } from '../fields/baseField';
import { FieldNumericalParam } from '../fields/fieldParser';
import { CubeType, FieldError } from './cubeDefinitions';

import { Buffer } from 'buffer';

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

  // HACKHACK: CCI field types currently included here as Typescript lacks
  // a proper way to extend enums.
  PADDING_SINGLEBYTE = 0x00 << 2,  // 0

  APPLICATION = 0x01 << 2,  // 4
  CONTINUED_IN = 0x02 << 2,  // 8

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
  SUBKEY_SEED = 0x03 << 2,  // 12

  PAYLOAD = 0x10 << 2,  // 64

  RELATES_TO = 0x13 << 2,  // 76
  USERNAME = 0x14 << 2,  // 80
  MEDIA_TYPE = 0x15 << 2,  // 84
  AVATAR = 0x16 << 2,
  PADDING = 0x1F << 2,  // 124
}

export const CubeFieldLength: FieldNumericalParam = {
  [CubeFieldType.TYPE]: NetConstants.CUBE_TYPE_SIZE,
  // NOTIFY not implemented yet
  // PMUC_UPDATE_COUNT not implemented yet
  [CubeFieldType.PUBLIC_KEY]: NetConstants.PUBLIC_KEY_SIZE,
  [CubeFieldType.DATE]: NetConstants.TIMESTAMP_SIZE,
  [CubeFieldType.SIGNATURE]: NetConstants.SIGNATURE_SIZE,
  [CubeFieldType.NONCE]: Settings.NONCE_SIZE,
  [CubeFieldType.CONTINUED_IN]: NetConstants.CUBE_KEY_SIZE,
  [CubeFieldType.SUBKEY_SEED]: undefined,
  [CubeFieldType.PAYLOAD]: undefined,
  [CubeFieldType.PADDING]: undefined,
  [CubeFieldType.AVATAR]: undefined,
  [CubeFieldType.PADDING_SINGLEBYTE]: 0,
  [CubeFieldType.APPLICATION]: undefined,
  [CubeFieldType.MEDIA_TYPE]: 1,
  [CubeFieldType.RELATES_TO]: NetConstants.RELATIONSHIP_TYPE_SIZE + NetConstants.CUBE_KEY_SIZE,
  [CubeFieldType.USERNAME]: undefined,
};

export class CubeField extends BaseField {
  static Type(cubeType: CubeType): CubeField {
    const typeFieldBuf: Buffer = Buffer.alloc(CubeFieldLength[CubeFieldType.TYPE]);
    typeFieldBuf.writeUIntBE(cubeType, 0, CubeFieldLength[CubeFieldType.TYPE]);
    return new CubeField(
      CubeFieldType.TYPE, typeFieldBuf);
  }

  static Date(cubeDate: number = unixtime()): CubeField {
    const dateFieldBuf: Buffer = Buffer.alloc(CubeFieldLength[CubeFieldType.DATE]);
    dateFieldBuf.writeUIntBE(cubeDate, 0, CubeFieldLength[CubeFieldType.DATE]);
    return new CubeField(
      CubeFieldType.DATE, dateFieldBuf);
  }

  static Nonce(): CubeField {
    const random_bytes = new Uint8Array(Settings.NONCE_SIZE);
    for (let i = 0; i < Settings.NONCE_SIZE; i++) {
      random_bytes[i] = Math.floor(Math.random() * 256);
    }
    return new CubeField(
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
      field = new CubeField(
        CubeFieldType.PADDING,
        Buffer.from(random_bytes));
    } else {
      field = new CubeField(
        CubeFieldType.PADDING_SINGLEBYTE,
        Buffer.alloc(0));
    }
    return field;
  }

  static PublicKey(publicKey: Buffer): CubeField {
    return new CubeField(
      CubeFieldType.PUBLIC_KEY,
      publicKey as Buffer);
  }

  static Signature(): CubeField {
    return new CubeField(
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

  constructor(type: number, value: Buffer, start?: number) {
    if (Settings.RUNTIME_ASSERTIONS && CubeFieldLength[type] !== undefined &&
        value.length !== CubeFieldLength[type]) {
      throw new FieldError(`Cannot construct CubeField of type ${type} with length ${value.length}, spec prescribes length of ${CubeFieldLength[type]}`);
    }
    super(type, value, start);
  }
}
