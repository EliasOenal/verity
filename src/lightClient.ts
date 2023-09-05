import { NetworkManager } from './model/networkManager';
import { CubeStore as CubeStore } from './model/cubeStore';
import { PeerDB, Peer } from './model/peerDB';
import { logger } from './model/logger';
import { Cube } from './model/cube';
import { Buffer } from 'buffer';
import readline from 'readline';
import { vera } from './misc/vera';
import { Field, Fields, CubeFieldType, CubeFields } from './model/fields';

// This is a light client that connects to a full node
// it does not announce and does not accept incoming connections.
// Light clients also do not request cubes unless they are explicitly requested.

async function main() {
    console.log("\x1b[36m" + vera + "\x1b[0m");
    logger.info('Starting light client');

    const initialPeer = process.argv[2];
    const payloadString = process.argv[3];

    if (!initialPeer) {
        console.error('An initial peer must be specified as a command line argument.');
        process.exit(1);
    }

    if (!payloadString) {
        console.error('A payload string must be specified as a command line argument.');
        process.exit(1);
    }

    const cubeStore = new CubeStore();
    const peerDB = new PeerDB();

    const [initialPeerIp, initialPeerPort] = initialPeer.split(':');
    const peer: Peer = new Peer(initialPeerIp, Number(initialPeerPort))
    peerDB.setPeersVerified([peer]);

    // The NetworkManager is created without a listening port,
    // it will not accept incoming connections.
    const networkManager = new NetworkManager(0, cubeStore, peerDB, false, true);
    const onlinePromise = new Promise(resolve => networkManager.once('online', () => {
        resolve(undefined);
    }));

    const shutdownPromise = new Promise(resolve => networkManager.once('shutdown', () => {
        logger.info('NetworkManager has shut down. Exiting...');
        resolve(undefined);
    }));

    networkManager.start();

    // Print stats when 's' is pressed
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);

    process.stdin.on('keypress', (str, key) => {
        if (key && key.ctrl && key.name == 'c') {
            process.exit();
        }

        if (str === 's') {
            logger.info('\n' + networkManager.prettyPrintStats());
        }

        if (str === 'c') {
            const cube = new Cube();
            const buffer = Buffer.alloc(4);
            // random buffer
            buffer.writeUInt32BE(Math.floor(Math.random() * 1000000));
            cube.setFields(new CubeFields([
                new Field(
                    CubeFieldType.PAYLOAD,
                    payloadString.length,
                    Buffer.from(payloadString, 'utf8')
                ),
                new Field(
                    // This one gets overwritten by the nonce
                    CubeFieldType.PADDING_NONCE,
                    4,
                    buffer
                ),
                new Field(
                    CubeFieldType.PADDING_NONCE,
                    4,
                    buffer
                )
            ]));
            cubeStore.addCube(cube);
        }
    });


    await onlinePromise;
    logger.info("Light client is online");

    await shutdownPromise;
}


main();
