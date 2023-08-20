// cubeUtil.ts
import { Buffer } from 'buffer';
import { sha3_256 } from 'js-sha3';
import { Cube } from './cube';
import { CubeMeta } from './cubeInfo';
import { logger } from './logger';

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
    let log2_c1 = Math.log2(c1);
    let log2_c2 = Math.log2(c2);
    let log2_x = Math.log2(x);

    // Calculate the number of days the cube lives
    let days = ((d1 - d2) * log2_x / (log2_c1 - log2_c2)) + ((d1 * log2_c2 - d2 * log2_c1) / (log2_c2 - log2_c1));

    return days;
}

export function cubeContest(localCube: CubeMeta, incomingCube: CubeMeta): CubeMeta {
    // Calculate the expiration date of each cube
    const expirationA = localCube.date + (cubeLifetime(localCube.challengeLevel) * 24 * 3600);
    const expirationB = incomingCube.date + (cubeLifetime(incomingCube.challengeLevel) * 24 * 3600);

    // Resolve the conflict based on expiration dates
    if (expirationA > expirationB) {
        return localCube;
    } else if (expirationB > expirationA) {
        return incomingCube;
    } else {
        logger.trace(`cubeUtil: Two Cubes with the key ${localCube.key.toString('hex')} have the same expiration date, local wins.`);
        return localCube;
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

export async function printCubeInfo(cube: Cube) {
    console.log("Version: " + cube.getVersion());
    console.log("Date: " + cube.getDate());
    console.log("Fields: ");
    for (let field of cube.getFields().data) {
        console.log("    Type: " + field.type);
        console.log("    Length: " + field.length);
        //console.log("    Value: " + field.value.toString('hex'));
    }
    console.log("Key: " + (await cube.getKey()).toString('hex'));
}