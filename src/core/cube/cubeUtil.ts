// cubeUtil.ts
import { BinaryDataError, CubeError, CubeSignatureError, CubeType, FingerprintError, SmartCubeTypeNotImplemented } from './cubeDefinitions';
import { Cube } from './cube';
import { CubeMeta } from './cubeInfo';
import { logger } from '../logger';

import { Buffer } from 'buffer';
import sodium, { KeyPair } from 'libsodium-wrappers'

import pkg from 'js-sha3';  // strange standards compliant syntax for importing
import { Settings } from '../settings';
const { sha3_256 } = pkg;   // commonJS modules as if they were ES6 modules

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
        case CubeType.BASIC:
            throw new CubeError("cubeUtil: Regular cubes cannot be contested.");
        case CubeType.MUC:
            // For MUCs the most recently minted cube wins. If they tie, the local
            // cube wins. We expect the owner of the MUC not to cause collisions.
            // If you do anyway - you brought it upon yourself.
            if (localCube.date >= incomingCube.date)
                return localCube;
            else
                return incomingCube;
        case CubeType.PIC:
            // Calculate the expiration date of each cube
            const expirationLocalCube = localCube.date + (cubeLifetime(localCube.challengeLevel) * UNIX_SECONDS_PER_EPOCH);
            const expirationIncomingCube = incomingCube.date + (cubeLifetime(incomingCube.challengeLevel) * UNIX_SECONDS_PER_EPOCH);

            // Resolve the conflict based on expiration dates
            if (expirationLocalCube > expirationIncomingCube) {
                return localCube;
            } else if (expirationIncomingCube > expirationLocalCube) {
                return incomingCube;
            } else {
                logger.trace(`cubeUtil: Two Cubes with the key ${localCube.key.toString('hex')} have the same expiration date, local wins.`);
                return localCube;
            }
        default:
            throw new CubeError("cubeUtil: Unknown cube type.");
    }
}

export function calculateHash(data: Buffer): Buffer {
    return Buffer.from(sha3_256.arrayBuffer(data));
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

// Verify fingerprint. This applies to smart cubes only.
export function verifyFingerprint(publicKeyValue: Buffer, providedFingerprint: Buffer): void {
    const calculatedFingerprint = calculateHash(publicKeyValue).slice(0, 8);  // First 8 bytes of signature field

    if (!calculatedFingerprint.equals(providedFingerprint)) {
        logger.error('Cube: Fingerprint does not match');
        throw new FingerprintError('Cube: Fingerprint does not match');
    }
}

// Verify signature. This applies to smart cubes only.
export function verifySignature(publicKeyValue: Buffer, signatureValue: Buffer, dataToVerify: Buffer): void {
    const data = new Uint8Array(dataToVerify);
    const signature = new Uint8Array(signatureValue);
    const publicKey = new Uint8Array(publicKeyValue);

    const isSignatureValid = sodium.crypto_sign_verify_detached(signature, data, publicKey);

    if (!isSignatureValid) {
        logger.error('Cube: Invalid signature');
        throw new CubeSignatureError('Cube: Invalid signature');
    }
}

export function parseSmartCube(type: number): number {
    switch (type & 0x03) {
        case CubeType.MUC:
            return CubeType.MUC;
        default:
            logger.error('Cube: Smart cube type not implemented ' + type);
            throw new SmartCubeTypeNotImplemented('Cube: Smart cube type not implemented ' + type);
    }
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
    // Disable cube retention policy
    if(Settings.CUBE_RETENTION_POLICY === false) return true;

    // Implement further check, we want to retain all cubes sculpted by the user
    // and all cubes sculpted by the user's trusted/subscribed peers

    const cubeLifetimeInEpochs = cubeLifetime(challengeLevel);
    const cubeDateInEpochs = Math.floor(cubeDate / UNIX_SECONDS_PER_EPOCH);
    const expirationEpoch = cubeDateInEpochs + cubeLifetimeInEpochs;

    // Cube should be retained if it hasn't expired and its sculpting date isn't set in the future
    return expirationEpoch >= currentEpoch && cubeDateInEpochs <= currentEpoch;
}