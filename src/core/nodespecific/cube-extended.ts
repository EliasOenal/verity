import { Cube } from '../cube'
import { logger } from '../logger'
import { Settings } from '../settings';
import { Worker } from 'worker_threads';
import path from 'path';

// This is broken because NodeJS, in our current ESM module configuration,
// just silently DIES when you do that o.O
Cube.prototype.findValidHash = function(nonceStartIndex: number): Promise<Buffer> {
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
                requiredDifficulty: this.required_difficulty,
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
