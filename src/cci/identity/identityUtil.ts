import type { CubeInfo } from "../../core/cube/cubeInfo";

import { CubeType } from "../../core/cube/cube.definitions";
import { DEFAULT_IDMUC_CONTEXT_STRING, IdentityOptions, IDMUC_MASTERINDEX } from "./identity.definitions";
import { deriveSigningKeypair, KeyPair } from "../helpers/cryptography";

import { Buffer } from 'buffer';
import sodium from 'libsodium-wrappers-sumo'


/** This function may only be called after awaiting sodium.ready. */
export function deriveIdentityRootCubeKeypair(masterKey: Buffer, options?: IdentityOptions): KeyPair {
  const contextString: string =
    options?.idmucContextString ?? DEFAULT_IDMUC_CONTEXT_STRING;
  return deriveSigningKeypair(masterKey, IDMUC_MASTERINDEX, contextString);
}

/** This function may only be called after awaiting sodium.ready. */
export function deriveIdentityMasterKey(
    username: string,
    password: string,
    argonCpuHardness = sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    argonMemoryHardness = sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
): Buffer {
  return Buffer.from(sodium.crypto_pwhash(
    sodium.crypto_sign_SEEDBYTES,
    password,
    sodium.crypto_hash(username, "uint8array").subarray(
      0, sodium.crypto_pwhash_SALTBYTES),
    argonCpuHardness,
    argonMemoryHardness,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
    "uint8array"));
}

export function validateIdentityRoot(mucInfo: CubeInfo): boolean {
  // is this even a MUC?
  if (mucInfo.cubeType !== CubeType.MUC &&
      mucInfo.cubeType !== CubeType.MUC_NOTIFY &&
      mucInfo.cubeType !== CubeType.PMUC &&
      mucInfo.cubeType !== CubeType.PMUC_NOTIFY
  ) {
    return false;
  }

  // Check if this is an Identity MUC by trying to create an Identity object
  // for it.
  // I'm not sure if that's efficient.
  // Disabled for now as it's not really important and forces us to make
  // MUC learning asynchroneous, which sometimes causes us to learn a MUC
  // too late.
  // let id: Identity;
  // try {
  //   const muc = ensureCci(mucInfo.getCube());
  //   if (muc === undefined) return false;
  //   id = await Identity.Construct(this.cubeStore, muc);
  // } catch (error) { return false; }
  return true;  // all checks passed
}

