import { Cube } from '../cube'
import { logger } from '../logger'
import { Settings } from '../config';
import { Worker } from 'worker_threads';
import path from 'path';

declare module "../cube" {
    interface Cube {
        findValidHashWorker(nonceStartIndex: number): Promise<Buffer>;
    }
}

Cube.prototype.findValidHashWorker = async function(nonceStartIndex: number): Promise<Buffer> {
    logger.trace("Running findValidHashWorker");
    return new Promise((resolve, reject) => {
        if (this.binaryData === undefined) {
            logger.error("Binary data not initialized");
            throw new Error("Binary data not initialized");
        }

        const workerFilePath = path.resolve(__dirname + '/hashWorker.js');

        const worker = new Worker(workerFilePath, {
            workerData: {
                binaryData: this.binaryData.buffer,  // Pass the underlying ArrayBuffer
                nonceStartIndex: nonceStartIndex,
                requiredDifficulty: Settings.REQUIRED_DIFFICULTY
            },
            transferList: [this.binaryData.buffer]  // Transfer ownership of the ArrayBuffer to the worker
        });

        worker.on('message', (message) => {
            this.hash = Buffer.from(message.hash);
            this.binaryData = Buffer.from(message.binaryData);
            logger.debug("Worker found valid hash, worker ID: " + worker.threadId + " hash: " + this.hash.toString('hex'));
            // Our old binaryData is now invalid, so we replace it with the new one
            resolve(this.hash);
        });
        worker.on('error', (err) => {
            logger.error("Worker error: " + err.message);
            reject(err);
        });
        worker.on('exit', (code) => {
            if (code != 0) {
                logger.error(`Worker stopped with exit code ${code}`);
                reject(new Error(`Worker stopped with exit code ${code}`));
            }
        });
    });
}    
