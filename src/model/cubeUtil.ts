// cubeUtil.ts
import { BinaryDataError, Cube, CubeSignatureError, FingerprintError, SmartCubeTypeNotImplemented } from './cube';
import { CubeMeta } from './cubeInfo';
import { CubeType } from './cubeDefinitions';
import { logger } from './logger';

import { Buffer } from 'buffer';
import { sha3_256 } from 'js-sha3';
import sodium, { KeyPair } from 'libsodium-wrappers'

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
 *  float: Cube lifetime
 */
export function cubeLifetime(x: number, d1: number = 7, d2: number = 28, c1: number = 12, c2: number = 20): number {
    // Calculate the base-2 logarithms
    const log2_c1 = Math.log2(c1);
    const log2_c2 = Math.log2(c2);
    const log2_x = Math.log2(x);

    // Calculate the number of days the cube lives
    const days = ((d1 - d2) * log2_x / (log2_c1 - log2_c2)) + ((d1 * log2_c2 - d2 * log2_c1) / (log2_c2 - log2_c1));

    return days;
}

export function cubeContest(localCube: CubeMeta, incomingCube: CubeMeta): CubeMeta {
    switch (localCube.cubeType) {
        case CubeType.CUBE_TYPE_REGULAR:
            throw new Error("cubeUtil: Regular cubes cannot be contested.");
        case CubeType.CUBE_TYPE_MUC:
            // For MUCs the most recently minted cube wins. If they tie, the local
            // cube wins. We expect the owner of the MUC not to cause collisions.
            // If you do anyway - you brought it upon yourself.
            if (localCube.date >= incomingCube.date)
                return localCube;
            else
                return incomingCube;
        case CubeType.CUBE_TYPE_IPC:
            // Calculate the expiration date of each cube
            const expirationLocalCube = localCube.date + (cubeLifetime(localCube.challengeLevel) * 24 * 3600);
            const expirationIncomingCube = incomingCube.date + (cubeLifetime(incomingCube.challengeLevel) * 24 * 3600);

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
            throw new Error("cubeUtil: Unknown cube type.");
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

// TODO document
export function updateVersionBinaryData(binaryData: Buffer, version: number, reservedBits: number) {
    if (binaryData === undefined)
        throw new BinaryDataError("Binary data not initialized");
    binaryData[0] = (version << 4) | reservedBits;
}

// TODO document
export function updateDateBinaryData(binaryData: Buffer, date: number) {
    if (binaryData === undefined)
        throw new BinaryDataError("Binary data not initialized");
    binaryData.writeUIntBE(date, 1, 5);
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
        case CubeType.CUBE_TYPE_MUC:
            return CubeType.CUBE_TYPE_MUC;
        default:
            logger.error('Cube: Smart cube type not implemented ' + type);
            throw new SmartCubeTypeNotImplemented('Cube: Smart cube type not implemented ' + type);
    }
}

export async function printCubeInfo(cube: Cube) {
    console.log("Version: " + cube.getVersion());
    console.log("Date: " + cube.getDate());
    console.log("Fields: ");
    for (const field of cube.getFields().data) {
        console.log("    Type: " + field.type);
        console.log("    Length: " + field.length);
        //console.log("    Value: " + field.value.toString('hex'));
    }
    console.log("Key: " + (await cube.getKey()).toString('hex'));
}