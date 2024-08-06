import { Settings, VerityError } from "../../core/settings";
import { cciField } from "./cciField";
import { cciFields, cciFieldParsers } from "./cciFields";
import { CubeError, CubeType, FieldError } from "../../core/cube/cube.definitions";

import { Cube, CubeOptions } from "../../core/cube/cube";
import { CubeFamilyDefinition } from "../../core/cube/cubeFields";

import sodium, { KeyPair, crypto_kdf_KEYBYTES } from 'libsodium-wrappers-sumo'
import { Buffer } from 'buffer'

export class cciCube extends Cube {
  static Frozen(options?: CubeOptions): cciCube {
    if (options === undefined) options = {};
    options.family = options?.family ?? cciFamily;
    const cube: cciCube = super.Frozen(options) as cciCube;
    if (Settings.RUNTIME_ASSERTIONS && !cube.assertCci?.()) {
      throw new CubeError("cciCube.Frozen: Freshly sculpted Cube does not in fact appear to be a CCI Cube");
    }
    return cube;
  }
  static MUC(
      publicKey: Buffer | Uint8Array,
      privateKey: Buffer | Uint8Array,
      options?: CubeOptions): cciCube {
    if (options === undefined) options = {};
    options.family = options?.family ?? cciFamily;
    const cube: cciCube = super.MUC(publicKey, privateKey, options) as cciCube;
    if (Settings.RUNTIME_ASSERTIONS && !cube.assertCci?.()) {
      throw new CubeError("cciCube.MUC: Freshly sculpted Cube does not in fact appear to be a CCI Cube");
    }
    return cube;
  }

  // TODO write unit test
  /** !!! May only be called after awaiting sodium.ready !!! */
  static ExtensionMuc(
    masterKey: Buffer | Uint8Array,
    fields: cciFields | cciField[],
    subkeyIndex: number = undefined, context: string = undefined,
    writeSubkeyIndexToCube: boolean = false,
    family: CubeFamilyDefinition = cciFamily,
    required_difficulty = Settings.REQUIRED_DIFFICULTY
  ): cciCube {
    masterKey = Uint8Array.from(masterKey);  // will strangely fail in vitest otherwise
    if (!(fields instanceof cciFields)) {
      fields = new cciFields(cciFields as any, family.parsers[CubeType.MUC].fieldDef);
    }
    if (subkeyIndex === undefined) {
      const max: number = Math.pow(2, (Settings.MUC_EXTENSION_SEED_SIZE*8)) - 1;
      subkeyIndex = Math.floor(  // TODO: Use a proper cryptographic function instead
        Math.random() * max);
    }
    if (context === undefined) context = "MUC extension key";
    const derivedSeed = sodium.crypto_kdf_derive_from_key(
      sodium.crypto_sign_SEEDBYTES, subkeyIndex, context,
      masterKey, "uint8array");
    const keyPair: KeyPair = sodium.crypto_sign_seed_keypair(
      derivedSeed, "uint8array");

    if (writeSubkeyIndexToCube) {
      // Write subkey to cube
      // Note: While this information is probably not harmful, it's only ever useful
      // to its owner. Maybe we should encrypt it.
      const nonceBuf = Buffer.alloc(Settings.MUC_EXTENSION_SEED_SIZE);
      nonceBuf.writeUintBE(subkeyIndex, 0, Settings.MUC_EXTENSION_SEED_SIZE);
      fields.appendField(cciField.SubkeySeed(Buffer.from(nonceBuf)));
    }

    // Create and return extension MUC
    const extensionMuc: cciCube = cciCube.MUC(
      keyPair.publicKey, keyPair.privateKey, {
        fields: fields,
        family: family,
        requiredDifficulty: required_difficulty
    });
    return extensionMuc;
  }

  constructor(
    param1: Buffer | CubeType,
    options: CubeOptions = {},
  ){
    options.family = options.family ?? cciFamily;
    super(param1, options)
  }


  public get fields(): cciFields {
    if (Settings.RUNTIME_ASSERTIONS && !(this.assertCci())) {
        throw new FieldError("This CCI Cube does not have CCI fields but " + this._fields.constructor.name);
    }
    return this._fields as cciFields;
  }

  assertCci(): boolean {
    if (this._fields instanceof cciFields) return true;
    else return false;
  }
}

// Note: Never move the family definition to another file as it must be
// executed strictly after the cciCube implementation. You may get uncaught
// ReferenceErrors otherwise.
export const cciFamily: CubeFamilyDefinition = {
  cubeClass: cciCube,
  parsers: cciFieldParsers,
}
