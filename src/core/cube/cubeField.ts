import { Settings } from '../settings';
import { NetConstants } from '../networking/networkDefinitions';
import { unixtime } from '../helpers/misc';

import { BaseField } from '../fields/baseField';
import { CubeFieldLength, CubeFieldType, CubeType, FieldError, RawcontentFieldType } from './cube.definitions';

import { Buffer } from 'buffer';
import { paddedBuffer } from './cubeUtil';

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

  static RawContent(cubeType: CubeType, content: string | Buffer = ""): CubeField {
    const fieldType: CubeFieldType = RawcontentFieldType[cubeType];
    const buf: Buffer = paddedBuffer(content, CubeFieldLength[fieldType]);
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
