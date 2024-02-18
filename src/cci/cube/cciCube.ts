import { Settings, VerityError } from "../../core/settings";
import { cciFields, cciField, cciFieldParsers } from "./cciFields";

import { Cube } from "../../core/cube/cube";

import sodium, { KeyPair, crypto_kdf_KEYBYTES } from 'libsodium-wrappers-sumo'
import { FieldParserTable } from "../../core/cube/cubeFields";
import { CubeType, FieldError } from "../../core/cube/cubeDefinitions";

export class cciCube extends Cube {
  class = cciCube;  // javascript introspection sucks

  // TODO: evaluate what makes a Cube a CCI Cube and put appropriate assertions in place,
  // e.g. fields must be cciFields
  static Frozen(
      data: cciFields | cciField[] | cciField = [],
      parsers: FieldParserTable = cciFieldParsers,
      required_difficulty = Settings.REQUIRED_DIFFICULTY): cciCube {
    return super.Frozen(data, parsers, cciCube, required_difficulty) as cciCube;
  }
  static MUC(
      publicKey: Buffer | Uint8Array,
      privateKey: Buffer | Uint8Array,
      data: cciFields | cciField[] | cciField = [],
      parsers: FieldParserTable = cciFieldParsers,
      required_difficulty = Settings.REQUIRED_DIFFICULTY): cciCube {
    return super.MUC(publicKey, privateKey, data, parsers, cciCube, required_difficulty) as cciCube;
  }

  // TODO write unit test
  /** !!! May only be called after awaiting sodium.ready !!! */
  static ExtensionMuc(
    masterKey: Uint8Array,
    fields: cciFields | cciField[],
    subkeyIndex: number = undefined, context: string = undefined,
    writeSubkeyIndexToCube: boolean = false,
    parsers: FieldParserTable = cciFieldParsers,
    required_difficulty = Settings.REQUIRED_DIFFICULTY
  ): cciCube {
  if (!(fields instanceof cciFields)) {
    fields = new cciFields(cciFields as any, parsers[CubeType.MUC].fieldDef);
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
    keyPair.publicKey, keyPair.privateKey, fields, parsers, required_difficulty);
  return extensionMuc;
  }

  public get fields(): cciFields {
    if (Settings.RUNTIME_ASSERTIONS && !(this._fields instanceof cciFields)) {
        throw new FieldError("This CCI Cube does not have CCI fields but " + this._fields.constructor.name);
    }
    return this._fields as cciFields;
  }

}

