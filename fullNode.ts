import { NetworkManager } from './networkManager';
import { CubeStore } from './cubeStore';
import { PeerDB, Peer } from './peerDB';
import { logger } from './logger';
import readline from 'readline';
import { Cube } from './cube';
import { vera } from './vera';
import { FieldType } from './fieldProcessing';
import sodium from 'libsodium-wrappers'

async function main() {
    console.log("\x1b[36m" + vera + "\x1b[0m");
    logger.info('Starting full node');
    let port = process.argv[2];
    let initialPeer = process.argv[3];

    if (!port) {
        port = '1984';
    }

    const cubeStorage = new CubeStore();
    const peerDB = new PeerDB();

    if (initialPeer) {
        const [initialPeerIp, initialPeerPort] = initialPeer.split(':');
        if (!initialPeerIp || !initialPeerPort) {
            console.error('Invalid initial peer specified.');
            process.exit(1);
        }
        const peer: Peer = new Peer(initialPeerIp, Number(initialPeerPort));
        peerDB.setPeersVerified([peer]);
    }

    const networkManager = new NetworkManager(parseInt(port), cubeStorage, peerDB, true);

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

    process.stdin.on('keypress', async (str, key) => {
        if (key && key.ctrl && key.name == 'c') {
            process.exit();
        }

        if (str === 's') {
            logger.info('\n' + networkManager.prettyPrintStats());
        }

        if ( str === 'm' ) {
            const keyPair = sodium.crypto_sign_keypair();
            const publicKey: Buffer = Buffer.from(keyPair.publicKey);
            const privateKey: Buffer = Buffer.from(keyPair.privateKey);
            let muc = new Cube();
            muc.setKeys(publicKey, privateKey);

            const fields = [
              { type: FieldType.TYPE_SPECIAL_CUBE | 0b00, length: 0, value: Buffer.alloc(0) },
              { type: FieldType.TYPE_PUBLIC_KEY, length: 32, value: publicKey },
              { type: FieldType.PADDING_NONCE, length: 909, value: Buffer.alloc(909) },
              { type: FieldType.TYPE_SIGNATURE, length: 72, value: Buffer.alloc(72) }];
        
            muc.setFields(fields);
            cubeStorage.addCube(muc);
        }

        if (str === 'c') {
            for (let i = 0; i < 1; i++) {
                for (let j = 0; j < 1; j++) {
                    let cube = new Cube();
                    let buffer = Buffer.alloc(4);
                    // random buffer
                    buffer.writeUInt32BE(Math.floor(Math.random() * 1000000));
                    cube.setFields([
                        {
                            type: FieldType.PAYLOAD,
                            length: "Hello Verity".length,
                            value: Buffer.from("Hello Verity", 'utf8')
                        },
                        {
                            // This one gets overwritten by the nonce
                            type: FieldType.PADDING_NONCE,
                            length: 4,
                            value: buffer
                        },
                        {
                            type: FieldType.PADDING_NONCE,
                            length: 4,
                            value: buffer
                        }
                    ]);
                    cubeStorage.addCube(cube);
                }
                await delay(10);
            }
        }
    });


    await onlinePromise;
    logger.info("Node is online");

    await shutdownPromise;

}

function delay(time: number) {
    return new Promise(resolve => setTimeout(resolve, time));
}

main();
