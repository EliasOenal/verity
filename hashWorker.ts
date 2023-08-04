import { parentPort, workerData } from 'worker_threads';
import { createHash } from 'crypto';
import { logger } from './logger.js';
import { exit } from 'process';

if (parentPort === null || workerData === null) {
    throw new Error('Parent port or worker data is null');
}

let nonce = 0;
let binaryData = Buffer.from(workerData.binaryData);  // Create a Buffer from the transferred ArrayBuffer

function calculateHash(data: Buffer): Buffer {
    const hasher = createHash('sha3-256');
    hasher.update(data);
    return hasher.digest();
}

function countTrailingZeroBits(buffer: Buffer): number {
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
    while ((byte & 1) === 0) {
        count++;
        byte >>= 1;
    }
    return count;
}

async function checkHash() {
    let hash: Buffer;
    do {
        // Write the nonce to binaryData
        binaryData.writeUInt32BE(nonce, workerData.nonceStartIndex);

        // Calculate the hash
        hash = calculateHash(binaryData);

        // Increment the nonce
        nonce++;
        
        // Check if the hash is valid
    } while (countTrailingZeroBits(hash) < workerData.requiredDifficulty)
    parentPort?.postMessage({ hash: hash, binaryData: Buffer.from(binaryData) });
    return;
};

// Start the hash checking
checkHash();
