import { Settings } from '../settings';
import { NetConstants } from '../networking/networkDefinitions';
import { unixtime } from '../helpers/misc';

import { BaseField } from '../fields/baseField';
import { FieldNumericalParam } from '../fields/fieldParser';
import { CubeType, FieldError } from './cubeDefinitions';

import { Buffer } from 'buffer';
import { coreFrozenParser } from './cubeFields';

// TODO: move all definitions to cubeDefinitions.ts maybe?

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
  NOTIFY = 2001,
  PMUC_UPDATE_COUNT = 2002, // not fully implemented yet
  PUBLIC_KEY = 2003,
  DATE = 2004,
  SIGNATURE = 2005,
  NONCE = 2006,

  // HACKHACK: CCI field types PAYLOAD, PADDING and CCI_END currently defined on
  // core layer as we use them within core unit tests.
  // TODO: Get rid of them here, use the raw Cube family throughout the core
  //       and then use the raw content fields in the core tests
  CCI_END = 0x00 << 2,  // 0
  PAYLOAD = 0x10 << 2,  // 64
  PADDING = 0x1F << 2,  // 124

  // fields exposing the full raw payload of the Cube at the core layer:
  FROZEN_RAWCONTENT = 2101,
  FROZEN_NOTIFY_RAWCONTENT = 2102,
  PIC_RAWCONTENT = 2103,
  PIC_NOTIFY_RAWCONTENT = 2104,
  MUC_RAWCONTENT = 2105,
  MUC_NOTIFY_RAWCONTENT = 2106,
  PMUC_RAWCONTENT = 2107,
  PMUC_NOTIFY_RAWCONTENT = 2108,
}

export const CubeFieldLength: FieldNumericalParam = {
  [CubeFieldType.TYPE]: NetConstants.CUBE_TYPE_SIZE,
  [CubeFieldType.NOTIFY]: NetConstants.NOTIFY_SIZE,
  [CubeFieldType.PMUC_UPDATE_COUNT]: NetConstants.PMUC_UPDATE_COUNT_SIZE,
  [CubeFieldType.PUBLIC_KEY]: NetConstants.PUBLIC_KEY_SIZE,
  [CubeFieldType.DATE]: NetConstants.TIMESTAMP_SIZE,
  [CubeFieldType.SIGNATURE]: NetConstants.SIGNATURE_SIZE,
  [CubeFieldType.NONCE]: NetConstants.NONCE_SIZE,
  [CubeFieldType.PAYLOAD]: undefined,  // TODO move to CCI
  [CubeFieldType.PADDING]: undefined,  // TODO move to CCI
  [CubeFieldType.CCI_END]: 0,  // TODO move to CCI
  // virtual fields exposing the raw content of the Cube at the core layer:
  [CubeFieldType.FROZEN_RAWCONTENT]: NetConstants.CUBE_SIZE - NetConstants.CUBE_TYPE_SIZE - NetConstants.TIMESTAMP_SIZE - NetConstants.NONCE_SIZE,
  [CubeFieldType.FROZEN_NOTIFY_RAWCONTENT]: NetConstants.CUBE_SIZE - NetConstants.CUBE_TYPE_SIZE - NetConstants.NOTIFY_SIZE - NetConstants.TIMESTAMP_SIZE - NetConstants.NONCE_SIZE,
  [CubeFieldType.PIC_RAWCONTENT]: NetConstants.CUBE_SIZE - NetConstants.CUBE_TYPE_SIZE - NetConstants.TIMESTAMP_SIZE - NetConstants.NONCE_SIZE,
  [CubeFieldType.PIC_NOTIFY_RAWCONTENT]: NetConstants.CUBE_SIZE - NetConstants.CUBE_TYPE_SIZE - NetConstants.NOTIFY_SIZE - NetConstants.TIMESTAMP_SIZE - NetConstants.NONCE_SIZE,
  [CubeFieldType.MUC_RAWCONTENT]: NetConstants.CUBE_SIZE - NetConstants.CUBE_TYPE_SIZE - NetConstants.PUBLIC_KEY_SIZE - NetConstants.TIMESTAMP_SIZE - NetConstants.SIGNATURE_SIZE - NetConstants.NONCE_SIZE,
  [CubeFieldType.MUC_NOTIFY_RAWCONTENT]: NetConstants.CUBE_SIZE - NetConstants.CUBE_TYPE_SIZE - NetConstants.NOTIFY_SIZE - NetConstants.PUBLIC_KEY_SIZE - NetConstants.TIMESTAMP_SIZE - NetConstants.SIGNATURE_SIZE - NetConstants.NONCE_SIZE,
  [CubeFieldType.PMUC_RAWCONTENT]: NetConstants.CUBE_SIZE - NetConstants.CUBE_TYPE_SIZE - NetConstants.PMUC_UPDATE_COUNT_SIZE - NetConstants.PUBLIC_KEY_SIZE - NetConstants.TIMESTAMP_SIZE - NetConstants.SIGNATURE_SIZE - NetConstants.NONCE_SIZE,
  [CubeFieldType.PMUC_NOTIFY_RAWCONTENT]: NetConstants.CUBE_SIZE - NetConstants.CUBE_TYPE_SIZE - NetConstants.NOTIFY_SIZE - NetConstants.PMUC_UPDATE_COUNT_SIZE - NetConstants.PUBLIC_KEY_SIZE - NetConstants.TIMESTAMP_SIZE - NetConstants.SIGNATURE_SIZE - NetConstants.NONCE_SIZE,
};

export const RawcontentFieldType: FieldNumericalParam = {
  [CubeType.FROZEN]: CubeFieldType.FROZEN_RAWCONTENT,
  [CubeType.FROZEN_NOTIFY]: CubeFieldType.FROZEN_NOTIFY_RAWCONTENT,
  [CubeType.PIC]: CubeFieldType.PIC_RAWCONTENT,
  [CubeType.PIC_NOTIFY]: CubeFieldType.PIC_NOTIFY_RAWCONTENT,
  [CubeType.MUC]: CubeFieldType.MUC_RAWCONTENT,
  [CubeType.MUC_NOTIFY]: CubeFieldType.MUC_NOTIFY_RAWCONTENT,
  [CubeType.PMUC]: CubeFieldType.PMUC_RAWCONTENT,
  [CubeType.PMUC_NOTIFY]: CubeFieldType.PMUC_NOTIFY_RAWCONTENT,
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
    const random_bytes = new Uint8Array(NetConstants.NONCE_SIZE);
    for (let i = 0; i < NetConstants.NONCE_SIZE; i++) {
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

  static PublicKey(publicKey?: Buffer): CubeField {
    if (publicKey === undefined) {
      publicKey = Buffer.alloc(NetConstants.PUBLIC_KEY_SIZE);
    }
    if (Settings.RUNTIME_ASSERTIONS && publicKey.length !== NetConstants.PUBLIC_KEY_SIZE) {
      throw new FieldError(`Cannot construct a Public Key field with length ${publicKey.length} as the spec prescribes a public key size of ${NetConstants.PUBLIC_KEY_SIZE}`);
    }
    return new this(CubeFieldType.PUBLIC_KEY, publicKey as Buffer);
  }

  static Signature(
      signature: Buffer = Buffer.alloc(NetConstants.SIGNATURE_SIZE, 0),
  ): CubeField {
    if (Settings.RUNTIME_ASSERTIONS && signature.length !== NetConstants.SIGNATURE_SIZE) {
      throw new FieldError(`Cannot construct a Signature field with length ${signature.length} as the spec prescribes a signature size of ${NetConstants.SIGNATURE_SIZE}`);
    }
    return new this(CubeFieldType.SIGNATURE, signature);
  }

  static RawContent(cubeType: CubeType, content: string | Buffer): CubeField {
    const fieldType: CubeFieldType = RawcontentFieldType[cubeType];
    const buf: Buffer = Buffer.alloc(CubeFieldLength[fieldType], 0);
    if (typeof content === 'string' || content instanceof String) {
      buf.write(content as string, 0, CubeFieldLength[fieldType], 'utf-8');
    } else {
      content.copy(buf, 0, 0, CubeFieldLength[fieldType]);
    }
    return new this(fieldType, buf);
  }

  static Notify(
      ref: Buffer = Buffer.alloc(NetConstants.NOTIFY_SIZE, 0),
  ): CubeField {
    if (Settings.RUNTIME_ASSERTIONS && ref.length !== NetConstants.NOTIFY_SIZE) {
      throw new FieldError(`Cannot construct a Notify field with length ${ref.length} as the spec prescribes a notify size of ${NetConstants.NOTIFY_SIZE}`);
    }
    return new this(CubeFieldType.NOTIFY, ref);
  }

  static PmucUpdateCount(count: number = 0) {
    const buf: Buffer = Buffer.alloc(CubeFieldLength[CubeFieldType.PMUC_UPDATE_COUNT]);
    buf.writeUIntBE(count, 0, CubeFieldLength[CubeFieldType.PMUC_UPDATE_COUNT]);
    return new this(CubeFieldType.PMUC_UPDATE_COUNT, buf);
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
