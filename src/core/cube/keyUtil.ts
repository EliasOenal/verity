import { logger } from "../logger";
import { NetConstants } from "../networking/networkDefinitions";
import { Settings } from "../settings";
import { CubeKey, NotificationKey } from "./cube.definitions";

import { Buffer } from 'buffer';

export interface KeyVariants {
    keyString: string;
    binaryKey: Buffer;
}
/**
 * This is a normalisation helper accepting binary data in either its string
 * or binary representation, and returning an object containing both.
 * It's main use is to convert Cube/Veritum keys for which we extensively use
 * both binary and string representations, but it can really be used for any
 * binary data.
 */
// maybe TODO optimise: return an object that lazily performs the conversion in
//   the getter to avoid unnecessary conversions
export function keyVariants(keyInput: Buffer | string | String): KeyVariants {
    if (!keyInput) return undefined;  // input sanity check
    let keyString: string, binaryKey: Buffer;
    if (Buffer.isBuffer(keyInput)) {
      keyString = keyInput.toString('hex');
      binaryKey = keyInput;
    } else {
      keyString = keyInput.toString();  // this gets rid of any "String" object we might have -- TODO: I'm not sure if this is efficient
      binaryKey = Buffer.from(keyInput as string, 'hex');
    }
    return {keyString: keyString, binaryKey: binaryKey};
}

/** Wrapper to create a type-safe branded CubeKey */
export function asCubeKey(key: Buffer | string): CubeKey {
  const binaryKey = keyVariants(key)?.binaryKey;
  if (binaryKey === undefined) return undefined;
  if (Settings.RUNTIME_ASSERTIONS && binaryKey.length !== NetConstants.CUBE_KEY_SIZE) {
    logger.warn(`cubeKey(): CubeKey must be ${NetConstants.CUBE_KEY_SIZE} bytes, but I got ${binaryKey.length} bytes`);
  }
  return binaryKey as CubeKey;
}

/** Wrapper to create a type-safe branded NotificationKey */
export function asNotificationKey(key: Buffer | string): NotificationKey {
  const binaryKey = keyVariants(key)?.binaryKey;
  if (binaryKey === undefined) return undefined;
  if (Settings.RUNTIME_ASSERTIONS && binaryKey.length !== NetConstants.NOTIFY_SIZE) {
    logger.warn(`notificationKey(): NotificationKey must be ${NetConstants.NOTIFY_SIZE} bytes, but I got ${binaryKey.length} bytes`);
  }
  return binaryKey as NotificationKey;
}
