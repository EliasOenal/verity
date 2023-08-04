// cubeUtil.ts
import { Buffer } from 'buffer';
import * as nacl from 'tweetnacl';
import { createHash } from 'crypto';
import { Cube } from './cube';

export function cubeLifetime(d1: number, d2: number, c1: number, c2: number, x: number): number {
    // Calculate the base-2 logarithms
    let log2_c1 = Math.log2(c1);
    let log2_c2 = Math.log2(c2);
    let log2_x = Math.log2(x);

    // Calculate the number of days the cube lives
    let days = ((d1 - d2) * log2_x / (log2_c1 - log2_c2)) + ((d1 * log2_c2 - d2 * log2_c1) / (log2_c2 - log2_c1));

    return days;
}

export function calculateHash(data: Buffer): Buffer {
    const hasher = createHash('sha3-256');
    hasher.update(data);
    return hasher.digest();
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
    for (let field of cube.getFields()) {
        console.log("    Type: " + field.type);
        console.log("    Length: " + field.length);
        //console.log("    Value: " + field.value.toString('hex'));
    }
    console.log("Hash: " + (await cube.getHash()).toString('hex'));
}