import { Cube } from "../../core/cube/cube";
import { CubeCreateOptions } from '../../core/cube/cube.definitions';
import { CubeType } from "../../core/cube/cube.definitions";
import { Settings } from "../../core/settings";
import { deriveSigningKeypair, KeyPair } from "../helpers/cryptography";
import { cciCube, cciFamily } from "./cciCube";
import { VerityField } from "./verityField";
import { VerityFields } from "./verityFields";

export function isCci(cube: Cube): boolean {
  if (cube instanceof cciCube && cube.assertCci()) return true;
  else return false;
}

export function ensureCci(cube: Cube): cciCube {
  if (isCci(cube)) return cube as cciCube;
  else return undefined;
}

export interface ExtensionMucOptions extends CubeCreateOptions {
  subkeyIndex?: number;
  contextString?: string;
  writeSubkeyIndexToCube?: boolean;
}

// TODO write unit test
/** !!! May only be called after awaiting sodium.ready !!! */
export function extensionMuc(
  masterKey: Uint8Array,
  options: ExtensionMucOptions = {},
): cciCube {
  // copy options and set defaults
  options = { ... options };
  options.cubeType ??= CubeType.PMUC;
  options.family ??= cciFamily;
  if (options.contextString === undefined) options.contextString = "MUC extension key";
  // normalise input
  if (!(options.fields instanceof VerityFields)) {
    options.fields = new VerityFields(
      options.fields as VerityFields,
      options.family.parsers[CubeType.MUC].fieldDef,
    );
  }

  // choose a random subkeyIndex if none was provided
  if (options.subkeyIndex === undefined) {
    const max: number = Math.pow(2, (Settings.MUC_EXTENSION_SEED_SIZE * 8)) - 1;
    options.subkeyIndex = Math.floor(  // TODO: Use a proper cryptographic function instead
      Math.random() * max);
  }

  // derive this extension MUC's signing key pair
  const keyPair: KeyPair = deriveSigningKeypair(
    masterKey, options.subkeyIndex, options.contextString);
  options.publicKey = keyPair.publicKey;
  options.privateKey = keyPair.privateKey;

  // If requested, write subkey to cube
  if (options.writeSubkeyIndexToCube) {
    // Note: While this information is probably not harmful, it's only ever useful
    // to its owner. Maybe we should encrypt it.
    const nonceBuf = Buffer.alloc(Settings.MUC_EXTENSION_SEED_SIZE);
    nonceBuf.writeUintBE(options.subkeyIndex, 0, Settings.MUC_EXTENSION_SEED_SIZE);
    options.fields.appendField(VerityField.SubkeySeed(Buffer.from(nonceBuf)));
  }

  // Create and return extension MUC
  const extensionMuc: cciCube = cciCube.Create(options);
  return extensionMuc;
}
