// cubeUtil.ts
import { Settings } from '../settings';
import { NetConstants } from '../networking/networkDefinitions';

import { CubeError, CubeKey, CubeType } from './cube.definitions';
import { Cube } from './cube';
import { CubeInfo } from './cubeInfo';

import { logger } from '../logger';

import { Buffer } from 'buffer';
import { isBrowser, isNode, isWebWorker, isJsDom, isDeno } from "browser-or-node";
import pkg from 'js-sha3';
import sodium from 'libsodium-wrappers-sumo'
import { CubeFamilyDefinition } from './cubeFields';

/*
 * Calculate the hash of a buffer using the SHA3-256 algorithm.
 * The implementation is dynamically loaded based on the runtime environment.
 * @param {Buffer} data - The data to hash.
 * @returns {Buffer} The hash of the data.
 */
export let calculateHash: (data: Buffer) => Buffer;
// Try to use the runtime's native crypto module as it will usually have
// better performance, except on JSDOM.
// (JSDOM would return the correct hash, but it would be in their own flavour
// of Buffer which is neither compatible with our Buffers nor based on
// Uint8Array.)
if (isNode && !isJsDom) {
  // Dynamically import the crypto module
  import("crypto")
    .then((crypto) => {
      calculateHash = (data: Buffer) => {
       return crypto.createHash("sha3-256").update(data).digest();;
      }
    })
    .catch((error) => {
      console.error("Failed to load crypto module:", error);
    });
} else {
    // Use the js-sha3 implementation
    calculateHash = (data: Buffer) => Buffer.from(pkg.sha3_256.arrayBuffer(data));
}

export function verifySignature(sig: Buffer, data: Buffer, pubkey:Buffer): boolean {
    return sodium.crypto_sign_verify_detached(sig, data, pubkey);
}


export const UNIX_SECONDS_PER_EPOCH = 5400;
export const UNIX_MS_PER_EPOCH = 5400000;
export const EPOCHS_PER_DAY = 16;

/*
 * Calculate the lifetime of a cube based on the hashcash challenge level x.
 *
 * Parameters:
 *   x (int): Hashcash challenge level
 *   d1 (int): Lower bound for the cube lifetime
 *   d2 (int): Upper bound for the cube lifetime
 *   c1 (int): Lower bound for the hashcash challenge level
 *   c2 (int): Upper bound for the hashcash challenge level
 *
 * Returns:
 *  float: Cube lifetime in epochs (5400 Unix Seconds per epoch, 16 epochs per day)
 */
export function cubeLifetime(x: number, e1: number = 0, e2: number = 960, c1: number = 10, c2: number = 80): number {
    // Linear function parameters
    const slope = (e2 - e1) / (c2 - c1);
    const intercept = e1 - (slope * c1);

    // Calculate the cube lifetime using the linear equation
    const lifetime = (slope * x) + intercept;

    return Math.floor(lifetime);
}

/**
 * Convenience wrapper around cubeLifetime() calculating a Cube's expiry date.
 * @param difficulty The Cube's hash cash level
 * @param sculptDate When the Cube was sculpted as a Unix timestamp
 * @returns The Cube's expiry date as a Unix timestamp
 */
export function cubeExpiration(cubeInfo: CubeInfo): number {
    return cubeInfo.date + cubeLifetime(cubeInfo.difficulty) * UNIX_SECONDS_PER_EPOCH;
}

export function cubeContest(localCube: CubeInfo, incomingCube: CubeInfo): CubeInfo {
    if (Settings.RUNTIME_ASSERTIONS && localCube.cubeType !== incomingCube.cubeType) {
        throw new CubeError(`cubeUtil.cubeContest(): cannot contest Cubes of different types; supplied Cube ${localCube.keyString} has type ${localCube.cubeType} while supplied Cube ${incomingCube.keyString} has type ${incomingCube.keyString}.`);
    }
    switch (localCube.cubeType) {
        case CubeType.FROZEN:
        case CubeType.FROZEN_NOTIFY:
            // Frozen Cubes are immutable, so they cannot be contested.
            // We define that local cube always wins as it will never make sense
            // to replace it.
            return localCube;
        case CubeType.PIC:
        case CubeType.PIC_NOTIFY:
            // Calculate the expiration date of each cube
            const expirationLocalCube = cubeExpiration(localCube);
            const expirationIncomingCube = cubeExpiration(incomingCube);

            // Resolve the conflict based on expiration dates
            if (expirationLocalCube > expirationIncomingCube) {
                return localCube;
            } else if (expirationIncomingCube > expirationLocalCube) {
                return incomingCube;
            } else {
                logger.trace(`cubeUtil: Two Cubes with the key ${localCube.key.toString('hex')} have the same expiration date, local wins.`);
                return localCube;
            }
            break;
        case CubeType.MUC:
        case CubeType.MUC_NOTIFY:
            // For MUCs the most recently sculpted cube wins. If they tie, the local
            // cube wins. We expect the owner of the MUC not to cause collisions.
            // If you do anyway - you brought it upon yourself.
            if (localCube.date >= incomingCube.date)
                return localCube;
            else
                return incomingCube;
            break;
        case CubeType.PMUC:
        case CubeType.PMUC_NOTIFY:
            // TODO implement: Highest PMUC_UPDATE_COUNT wins, and if those tie
            // highest expiration time wins.
            // However, PMUC_UPDATE_COUNT is not yet available through CubeInfo,
            // nor is it provided on KeyExchange.
            const localVersion: number = localCube.updatecount ?? 0;
            const incomingVersion: number = incomingCube.updatecount ?? 0;
            if (localVersion > incomingVersion)
                return localCube;
            else if (localVersion < incomingVersion)
                return incomingCube;
            else {
                // Same update count, use expiration as tie breaker
                const localExpiration: number = cubeExpiration(localCube);
                const incomingExpiration: number = cubeExpiration(incomingCube);
                if (localExpiration > incomingExpiration)
                    return localCube;
                else if (incomingExpiration > localExpiration)
                    return incomingCube;
                else {
                    return localCube;  // Github#579 need better tie breaker rule
                }
            }
            break;
        default:
            throw new CubeError(`cubeUtil.cubeContest(): supplied Cube ${localCube.keyString} has unknown type ${localCube.cubeType}`);
    }
}

export function countTrailingZeroBits(buffer: Buffer): number {
    let count = 0;
    let byte = 0xFF;
    for (let i = buffer.length - 1; i >= 0; i--) {
        byte = buffer[i];
        if (byte === 0) {
            count += 8;
        } else {
            break;
        }
    }
    // Count trailing zero bits in the last non-zero byte
    for (let j = 0; j < 8; j++) {
        if ((byte & 1) === 0) {
            count++;
            byte >>= 1;
        } else {
            break;
        }
    }
    return count;
}

export async function printCubeInfo(cube: Cube) {
    console.log("Date: " + cube.getDate());
    console.log("Fields: ");
    for (const field of cube.fields.all) {
        console.log("    Type: " + field.type);
        console.log("    Length: " + field.length);
        //console.log("    Value: " + field.value.toString('hex'));
    }
    console.log("Key: " + (await cube.getKey()).toString('hex'));
}

/**
* Calculates and returns the current epoch.
* An epoch is defined as a fixed time period for this application's context,
* with each epoch lasting 5400 seconds (90 minutes).
*
* @returns {number} The current epoch.
*/
export function getCurrentEpoch(): number {
   return Math.floor(Date.now() / UNIX_MS_PER_EPOCH);
}

// Unix time to epoch
export function unixTimeToEpoch(unixTime: number): number {
    return Math.floor(unixTime / UNIX_SECONDS_PER_EPOCH);
}

/**
 * Determines if a cube should be retained based on its sculpting date and hashcash challenge level.
 *
 * @param cubeDate The sculpting date of the cube (in epochs).
 * @param challengeLevel The hashcash challenge level of the cube.
 * @param currentEpoch The current epoch for comparison.
 * @returns {boolean} True if the cube should be retained, false if it should be pruned.
 */
export function shouldRetainCube(key: String, cubeDate: number, challengeLevel: number, currentEpoch: number): boolean {
    // Implement further check, we want to retain all cubes sculpted by the user
    // and all cubes sculpted by the user's trusted/subscribed peers

    const cubeLifetimeInEpochs = cubeLifetime(challengeLevel);
    const cubeDateInEpochs = Math.floor(cubeDate / UNIX_SECONDS_PER_EPOCH);
    const expirationEpoch = cubeDateInEpochs + cubeLifetimeInEpochs;

    // Cube should be retained if it hasn't expired and its sculpting date isn't set in the future
    return expirationEpoch >= currentEpoch && cubeDateInEpochs <= currentEpoch;
}

export interface KeyVariants {
    keyString: string;
    binaryKey: CubeKey;
}
/**
 * This is a normalisation helper accepting a Cube key in either its string
 * or binary representation, and returning an object containing both.
 */
// maybe TODO optimise: return an object that lazily performs the conversion in
//   the getter to avoid unnecessary conversions
export function keyVariants(keyInput: CubeKey | string | String): KeyVariants {
    if (!keyInput) return undefined;  // input sanity check
    let keyString: string, binaryKey: CubeKey;
    if (Buffer.isBuffer(keyInput)) {
      keyString = keyInput.toString('hex');
      binaryKey = keyInput;
    } else {
      keyString = keyInput.toString();  // this gets rid of any "String" object we might have -- TODO: I'm not sure if this is efficient
      binaryKey = Buffer.from(keyInput as string, 'hex');
    }
    // maybe TODO sanity check
    // note: even though it may not seem like it, this is a significant API change
    //   and breaks a whole lot of tests
    // if (binaryKey.length != NetConstants.CUBE_KEY_SIZE) {
    //   logger.trace(`keyVariants(): Got invalid key ${keyString} of length ${binaryKey.length} instead of ${NetConstants.CUBE_KEY_SIZE}, returning undefined`);
    //   return undefined;
    // }
    return {keyString: keyString, binaryKey: binaryKey};
}

export function typeFromBinary(binaryCube: Buffer): CubeType {
    if (!(binaryCube instanceof Buffer)) return undefined;
    return binaryCube.readUIntBE(0, NetConstants.CUBE_TYPE_SIZE);
}

export function dateFromBinary(binary: Buffer): number {
    const cubeType = typeFromBinary(binary);
    let datePosition;

    switch (cubeType) {
        case CubeType.FROZEN:
        case CubeType.FROZEN_NOTIFY:
        case CubeType.PIC:
        case CubeType.PIC_NOTIFY:
            datePosition = NetConstants.CUBE_SIZE - NetConstants.NONCE_SIZE - NetConstants.TIMESTAMP_SIZE;
            break;
        case CubeType.MUC:
        case CubeType.MUC_NOTIFY:
        case CubeType.PMUC:
        case CubeType.PMUC_NOTIFY:
            datePosition = NetConstants.CUBE_SIZE - NetConstants.NONCE_SIZE - NetConstants.SIGNATURE_SIZE - NetConstants.TIMESTAMP_SIZE;
            break;
        default:
            throw new CubeError(`Unsupported cube type: ${cubeType}`);
    }

    return binary.readUIntBE(datePosition, NetConstants.TIMESTAMP_SIZE);
}

export function paddedBuffer(content: string | Buffer = "", length: number): Buffer {
  // allocate Buffer of given length and fill with zeros
  const buf: Buffer = Buffer.alloc(length, 0);
  // write content to the Buffer
  if (typeof content === 'string' || content instanceof String) {
    // if it's a string, encode as utf-8 and write to Buffer
    buf.write(content as string, 0, length, 'utf-8');
  } else {
    // if it's a Buffer, just copy the content
    content.copy(buf, 0, 0, length);
  }
  return buf;
}

export function activateCube<cubeClass extends Cube>(
    binaryCube: Buffer,
    families: Iterable<CubeFamilyDefinition>,
): cubeClass {
  // try to reactivate Cube using one of my supported family settings
  let cube: Cube;
  for (const family of families) {
    try {
      cube = new family.cubeClass(binaryCube, { family: family });
      break;
    } catch (err) {
      undefined; // do nothing, just try next one
    }
  }
  if (cube === undefined) {
      logger.info('activateCube(): Could not activate Cube using any of the supplied CubeFamily settings');
  }
  return cube as cubeClass;
}

/**
 * Estimate Cube store size based on the density of a few succeeding Cube keys.
 * @param {Buffer} cubeKeys[] - A Buffer containing the hashes of a few succeeding Cubes.
 * @returns {number} The estimated size of the Cube store in number of Cubes.
 */
export function estimateStoreSize(cubeKeys: Buffer[]): number {
    // Implement me
    throw new Error("estimateStoreSize: Not implemented");
    return 0;
}