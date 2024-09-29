import { CubeCreateOptions, VeritableBaseImplementation } from "../../core/cube/cube";
import { HasSignature, type CubeKey, type CubeType } from "../../core/cube/cube.definitions";
import { keyVariants } from "../../core/cube/cubeUtil";
import type { Veritable } from "../../core/cube/veritable.definition";
import { cciCube, cciFamily } from "../cube/cciCube";
import { cciFields } from "../cube/cciFields";
import { Continuation } from "./continuation";
import { CciEncryptionOptions, Decrypt, Encrypt, EncryptionRecipients } from "./encryption";

import { Buffer } from 'buffer';

export class Veritum extends VeritableBaseImplementation implements Veritable{
  protected _compiled: Array<cciCube>;
  get compiled(): Iterable<cciCube> { return this._compiled }

  declare protected _fields: cciFields;

  readonly publicKey: Buffer;
  readonly privateKey: Buffer;

  constructor(cubeType: CubeType, options?: CubeCreateOptions);
  constructor(copyFrom: Veritum);

  constructor(param1: CubeType|Veritum, options: CubeCreateOptions = {}) {
    if (param1 instanceof Veritum) {
      // copy constructor
      const copyFrom: Veritum = param1;
      options = {
        family: copyFrom.family,
        fields: new cciFields(copyFrom._fields, copyFrom._fields.fieldDefinition),  // shallow copy
        privateKey: copyFrom.privateKey,
        publicKey: copyFrom.publicKey,
        requiredDifficulty: copyFrom.requiredDifficulty,
      }
      super(copyFrom.cubeType, options);
    } else {
      // creating new Veritum
      const cubeType = param1;
      options.family ??= cciFamily;
      super(cubeType, options);
      this.publicKey = options.publicKey;
      this.privateKey = options.privateKey;
    }
  }

  getKeyIfAvailable(): CubeKey {
    if (HasSignature[this.cubeType]) return this.publicKey;
    else return this._compiled?.[0]?.getKeyIfAvailable();
  }
  getKeyStringIfAvailable(): string {
    if (HasSignature[this.cubeType]) return keyVariants(this.publicKey).keyString;
    else return this._compiled?.[0]?.getKeyStringIfAvailable();
  }

  encrypt(
      privateKey: Buffer,
      recipients: EncryptionRecipients,
      options?: CciEncryptionOptions,
  ): void {
    this._fields = Encrypt(this._fields, privateKey, recipients, options);
  }

  decrypt(privateKey: Buffer, senderPublicKey?: Buffer): void {
    this._fields = Decrypt(this._fields, privateKey, senderPublicKey);
  }

  async compile(): Promise<Iterable<cciCube>> {
    this._compiled = await Continuation.Split(this);
    return this._compiled;
  }

}
