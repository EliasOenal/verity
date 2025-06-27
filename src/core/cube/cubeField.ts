import type { FieldFactoryParam } from '../fields/fieldParser';

import { Settings } from '../settings';
import { CubeFieldLength, CubeFieldType, CubeType, FieldError, NotificationKey, RawcontentFieldType } from './cube.definitions';
import { unixtime } from '../helpers/misc';

import { BaseField } from '../fields/baseField';
import { paddedBuffer } from './cubeUtil';
import { NetConstants } from '../networking/networkDefinitions';

import { Buffer } from 'buffer';

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

  static Nonce(random: boolean = false): CubeField {
    const content = Buffer.alloc(NetConstants.NONCE_SIZE, 0);
    if (random) for (let i = 0; i < NetConstants.NONCE_SIZE; i++) {
      content[i] = Math.floor(Math.random() * 256);
    }
    return new this(CubeFieldType.NONCE, content);
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
      ref: NotificationKey = Buffer.alloc(NetConstants.NOTIFY_SIZE, 0) as NotificationKey,
  ): CubeField {
    if (Settings.RUNTIME_ASSERTIONS && ref.length !== NetConstants.NOTIFY_SIZE) {
      throw new FieldError(`Cannot construct a Notify field with length ${ref.length} as the spec prescribes a notify size of ${NetConstants.NOTIFY_SIZE}`);
    }
    return new this(CubeFieldType.NOTIFY, ref);
  }

  /**
   * Constructs a PMUC_UPDATE_COUNT field, which is the mandatory version counter
   * for PMUCs.
   * In this implementation, the PMUC counter is by default initially set to 0.
   * Unless you set it manually, we will attempt to auto-increment it on
   * compilation based on any previous version we have in our local CubeStore.
   * Note that this obviously does not reliably prevent lost updates!
   * @param count The count to set
   */
  static PmucUpdateCount(count: number = 0): CubeField {
    const buf: Buffer = Buffer.alloc(CubeFieldLength[CubeFieldType.PMUC_UPDATE_COUNT]);
    buf.writeUIntBE(count, 0, CubeFieldLength[CubeFieldType.PMUC_UPDATE_COUNT]);
    return new this(CubeFieldType.PMUC_UPDATE_COUNT, buf);
  }

  constructor(type: number, value: Buffer | string | String, start?: number);
  constructor(copyFrom: CubeField);
  constructor(param1: number|CubeField, value?: Buffer | string, start?: number);
  constructor(param1: number|CubeField, value?: Buffer | string, start?: number) {
    if (Settings.RUNTIME_ASSERTIONS && typeof param1 === 'number' && CubeFieldLength[param1] !== undefined &&
        value.length !== CubeFieldLength[param1]) {
      throw new FieldError(`Cannot construct CubeField of type ${param1} with length ${value.length}, spec prescribes length of ${CubeFieldLength[param1]}`);
    }
    super(param1, value, start);
  }
}


// Default field defitions

export const FrozenDefaultFields: FieldFactoryParam = {
  [CubeFieldType.TYPE]: () => CubeField.Type(CubeType.FROZEN),
  [CubeFieldType.FROZEN_RAWCONTENT]: () => CubeField.RawContent(CubeType.FROZEN),
  [CubeFieldType.DATE]: () => CubeField.Date(),
  [CubeFieldType.NONCE]: () => CubeField.Nonce(),
};
export const FrozenNotifyDefaultFields: FieldFactoryParam = {
  [CubeFieldType.TYPE]: () => CubeField.Type(CubeType.FROZEN_NOTIFY),
  [CubeFieldType.FROZEN_NOTIFY_RAWCONTENT]: () => CubeField.RawContent(CubeType.FROZEN_NOTIFY),
  [CubeFieldType.NOTIFY]: () => CubeField.Notify(),
  [CubeFieldType.DATE]: () => CubeField.Date(),
  [CubeFieldType.NONCE]: () => CubeField.Nonce(),
};
export const PicDefaultFields: FieldFactoryParam = {
  [CubeFieldType.TYPE]: () => CubeField.Type(CubeType.PIC),
  [CubeFieldType.PIC_RAWCONTENT]: () => CubeField.RawContent(CubeType.PIC),
  [CubeFieldType.DATE]: () => CubeField.Date(),
  [CubeFieldType.NONCE]: () => CubeField.Nonce(),
};
export const PicNotifyDefaultFields: FieldFactoryParam = {
  [CubeFieldType.TYPE]: () => CubeField.Type(CubeType.PIC_NOTIFY),
  [CubeFieldType.PIC_NOTIFY_RAWCONTENT]: () => CubeField.RawContent(CubeType.PIC_NOTIFY),
  [CubeFieldType.NOTIFY]: () => CubeField.Notify(),
  [CubeFieldType.DATE]: () => CubeField.Date(),
  [CubeFieldType.NONCE]: () => CubeField.Nonce(),
};
export const MucDefaultFields: FieldFactoryParam = {
  [CubeFieldType.TYPE]: () => CubeField.Type(CubeType.MUC),
  [CubeFieldType.MUC_RAWCONTENT]: () => CubeField.RawContent(CubeType.MUC),
  [CubeFieldType.NONCE]: () => CubeField.Nonce(),
  [CubeFieldType.SIGNATURE]: () => CubeField.Signature(),
  [CubeFieldType.DATE]: () => CubeField.Date(),
  [CubeFieldType.PUBLIC_KEY]: () => CubeField.PublicKey(),
};
export const MucNotifyDefaultFields: FieldFactoryParam = {
  [CubeFieldType.TYPE]: () => CubeField.Type(CubeType.MUC_NOTIFY),
  [CubeFieldType.MUC_NOTIFY_RAWCONTENT]: () => CubeField.RawContent(CubeType.MUC_NOTIFY),
  [CubeFieldType.NOTIFY]: () => CubeField.Notify(),
  [CubeFieldType.NONCE]: () => CubeField.Nonce(),
  [CubeFieldType.SIGNATURE]: () => CubeField.Signature(),
  [CubeFieldType.DATE]: () => CubeField.Date(),
  [CubeFieldType.PUBLIC_KEY]: () => CubeField.PublicKey(),
};
export const PmucDefaultFields: FieldFactoryParam = {
  [CubeFieldType.TYPE]: () => CubeField.Type(CubeType.PMUC),
  [CubeFieldType.PMUC_RAWCONTENT]: () => CubeField.RawContent(CubeType.PMUC),
  [CubeFieldType.NONCE]: () => CubeField.Nonce(),
  [CubeFieldType.SIGNATURE]: () => CubeField.Signature(),
  [CubeFieldType.DATE]: () => CubeField.Date(),
  [CubeFieldType.PUBLIC_KEY]: () => CubeField.PublicKey(),
  [CubeFieldType.PMUC_UPDATE_COUNT]: () => CubeField.PmucUpdateCount(),
};
export const PmucNotifyDefaultFields: FieldFactoryParam = {
  [CubeFieldType.TYPE]: () => CubeField.Type(CubeType.PMUC_NOTIFY),
  [CubeFieldType.PMUC_NOTIFY_RAWCONTENT]: () => CubeField.RawContent(CubeType.PMUC_NOTIFY),
  [CubeFieldType.NOTIFY]: () => CubeField.Notify(),
  [CubeFieldType.NONCE]: () => CubeField.Nonce(),
  [CubeFieldType.SIGNATURE]: () => CubeField.Signature(),
  [CubeFieldType.DATE]: () => CubeField.Date(),
  [CubeFieldType.PUBLIC_KEY]: () => CubeField.PublicKey(),
  [CubeFieldType.PMUC_UPDATE_COUNT]: () => CubeField.PmucUpdateCount(),
};
