// cubeUtil.ts
import { NetConstants } from '../networking/networkDefinitions';
import { CubeError, CubeKey, CubeType } from './cube.definitions';
import { Cube } from './cube';
import { CubeMeta } from './cubeInfo';

import { logger } from '../logger';
import { Buffer } from 'buffer';
import { isBrowser, isNode, isWebWorker, isJsDom, isDeno } from "browser-or-node";

/*
 * Calculate the hash of a buffer using the SHA3-256 algorithm.
 * The implementation is dynamically loaded based on the runtime environment.
 * @param {Buffer} data - The data to hash.
 * @returns {Buffer} The hash of the data.
 */
export let calculateHash: (data: Buffer) => Buffer;
if (isNode) {
  // Dynamically import the crypto module
  import("crypto")
    .then((crypto) => {
      calculateHash = (data: Buffer) =>
        Buffer.from(crypto.createHash("sha3-256").update(data).digest());
    })
    .catch((error) => {
      console.error("Failed to load crypto module:", error);
    });
} else {
  // Use the js-sha3 implementation
  import("js-sha3")
    .then((pkg) => {
      calculateHash = (data: Buffer) => Buffer.from(pkg.sha3_256.arrayBuffer(data));
    })
    .catch((error) => {
      console.error("Failed to load js-sha3 module:", error);
    });
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

export function cubeContest(localCube: CubeMeta, incomingCube: CubeMeta): CubeMeta {
    switch (localCube.cubeType) {
        case CubeType.FROZEN:
            throw new CubeError("cubeUtil: Regular cubes cannot be contested.");
        case CubeType.MUC:
            // For MUCs the most recently sculpted cube wins. If they tie, the local
            // cube wins. We expect the owner of the MUC not to cause collisions.
            // If you do anyway - you brought it upon yourself.
            if (localCube.date >= incomingCube.date)
                return localCube;
            else
                return incomingCube;
            break;
        case CubeType.PIC:
            // Calculate the expiration date of each cube
            const expirationLocalCube = localCube.date + (cubeLifetime(localCube.difficulty) * UNIX_SECONDS_PER_EPOCH);
            const expirationIncomingCube = incomingCube.date + (cubeLifetime(incomingCube.difficulty) * UNIX_SECONDS_PER_EPOCH);

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
        default:
            throw new CubeError("cubeUtil: Unknown cube type.");
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

export function keyVariants(keyInput: CubeKey | string): {keyString: string, binaryKey: CubeKey} {
    let keyString: string, binaryKey: CubeKey;
    if (keyInput instanceof Buffer) {
      keyString = keyInput.toString('hex');
      binaryKey = keyInput;
    } else {
      keyString = keyInput;
      binaryKey = Buffer.from(keyInput, 'hex');
    }
    return {keyString: keyString, binaryKey: binaryKey};
}

export function typeFromBinary(binaryCube: Buffer): CubeType {
    if (!(binaryCube instanceof Buffer)) return undefined;
    return binaryCube.readIntBE(0, NetConstants.CUBE_TYPE_SIZE);
}

export function dateFromBinary(binary: Buffer): number {
    const cubeType = typeFromBinary(binary);
    let datePosition;

    switch (cubeType) {
        case CubeType.FROZEN:
            datePosition = NetConstants.CUBE_SIZE - NetConstants.NONCE_SIZE - NetConstants.TIMESTAMP_SIZE;
            break;
        case CubeType.PIC:
            datePosition = NetConstants.CUBE_SIZE - NetConstants.NONCE_SIZE - NetConstants.TIMESTAMP_SIZE;
            break;
        case CubeType.MUC:
            datePosition = NetConstants.CUBE_SIZE - NetConstants.NONCE_SIZE - NetConstants.SIGNATURE_SIZE - NetConstants.TIMESTAMP_SIZE;
            break;
        case CubeType.PMUC:
            datePosition = NetConstants.CUBE_SIZE - NetConstants.NONCE_SIZE - NetConstants.SIGNATURE_SIZE - NetConstants.TIMESTAMP_SIZE;
            break;
        default:
            throw new CubeError(`Unsupported cube type: ${cubeType}`);
    }

    return binary.readUIntBE(datePosition, NetConstants.TIMESTAMP_SIZE);
}
