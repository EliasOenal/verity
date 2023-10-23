import { Settings, VerityError } from "../core/settings";
import { NetConstants } from "../core/networking/networkDefinitions";

import { Cube } from "../core/cube/cube";
import { CubeFields, CubeField } from "../core/cube/cubeFields";

import sodium, { KeyPair, crypto_kdf_KEYBYTES } from 'libsodium-wrappers'

export function sculptExtensionMuc(
    masterKey: Uint8Array,
    fields: CubeFields | CubeField | [CubeField],
    subkeyIndex: number = undefined, context: string = undefined,
    writeSubkeyIndexToCube: boolean = false,
    required_difficulty = Settings.REQUIRED_DIFFICULTY
): Cube {
  if (!(fields instanceof CubeFields)) fields = new CubeFields(fields, false);

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
    fields.appendField(CubeField.SubkeySeed(Buffer.from(nonceBuf)));
  }

  // Create and return extension MUC
  const extensionMuc: Cube = Cube.MUC(
    keyPair.publicKey, keyPair.privateKey,
    fields as CubeFields,
    required_difficulty);
  return extensionMuc;
}
