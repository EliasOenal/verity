import { isBrowser, isNode, isWebWorker, isJsDom, isDeno } from "browser-or-node";
import { NetworkManager } from './networkManager';
import { CubeStore } from './cubeStore';
import { PeerDB, Peer } from './peerDB';
import { logger } from './logger';
import { Cube } from './cube';
import { vera } from './vera';
import sodium from 'libsodium-wrappers'
import { FieldType, Field } from './fieldProcessing';
import { EventEmitter } from 'events';
import { NetworkPeer } from "./networkPeer";
import * as fp from './fieldProcessing';
import { Buffer } from 'buffer';

var readline: any;
if (isNode) {
    readline = require('readline');
}

function delay(time: number) {
    return new Promise(resolve => setTimeout(resolve, time));
}


export class fullNode {
    port: number = 1984;
    cubeStore: CubeStore = new CubeStore();
    peerDB: PeerDB = new PeerDB();
    announce: boolean = false;
    networkManager: NetworkManager;
    onlinePromise: any = undefined;
    shutdownPromise: any = undefined;

    constructor(){
        let initialPeers = [
            "verity.hahn.mt:1984",
            "verity.hahn.mt:1985",
            "verity.hahn.mt:1986",
            "132.145.174.233:1984",
            "158.101.100.95:1984",
        ];
        if (isNode) {
            if (process.argv[2]) this.port = Number(process.argv[2]);
            if (process.argv[3]) initialPeers = [process.argv[3]];
        }
        if (isNode) {
            this.announce = true;
        } else {
            this.announce = false;
        }

        this.networkManager = new NetworkManager(this.port, this.cubeStore, this.peerDB, this.announce);

        if (initialPeers) {
            for (let i=0; i<initialPeers.length; i++) {
                logger.info(`Adding initial peer ${initialPeers[i]}.`);
                const [initialPeerIp, initialPeerPort] = initialPeers[i].split(':');
                if (!initialPeerIp || !initialPeerPort) {
                    console.error('Invalid initial peer specified.');
                }
                const peer: Peer = new Peer(initialPeerIp, Number(initialPeerPort));
                this.peerDB.setPeersUnverified([peer]);
                this.networkManager.connect(peer);
            }
        }

        this.onlinePromise = new Promise(resolve => this.networkManager.once('online', () => {
            resolve(undefined);
        }));

        this.shutdownPromise = new Promise(resolve => this.networkManager.once('shutdown', () => {
            logger.info('NetworkManager has shut down. Exiting...');
            resolve(undefined);
        }));

        this.networkManager.start();

        if (isNode) {  // Provide debugging hotkeys
            readline.emitKeypressEvents(process.stdin);
            if (process.stdin.isTTY) process.stdin.setRawMode(true);

            process.stdin.on('keypress', async (str, key) => {
                if (key && key.ctrl && key.name == 'c') process.exit();
                if (str === 's') logger.info('\n' + this.networkManager.prettyPrintStats());
                if ( str === 'm' ) this.makeNewMuc();
                if (str === 'c') this.makeNewCube();
            });
        }
    }

    public async makeNewMuc() {
        const keyPair = sodium.crypto_sign_keypair();
        const publicKey: Buffer = Buffer.from(keyPair.publicKey);
        const privateKey: Buffer = Buffer.from(keyPair.privateKey);
        let muc = new Cube();
        muc.setKeys(publicKey, privateKey);

        const fields = [
            { type: FieldType.TYPE_SMART_CUBE | 0b00, length: 0, value: Buffer.alloc(0) },
            { type: FieldType.TYPE_PUBLIC_KEY, length: 32, value: publicKey },
            { type: FieldType.PAYLOAD, length: 9, value: Buffer.from("Hello MUC", 'utf8') },
            { type: FieldType.PADDING_NONCE, length: 898, value: Buffer.alloc(898) },
            { type: FieldType.TYPE_SIGNATURE, length: 72, value: Buffer.alloc(72) }
        ];

        muc.setFields(fields);
        this.cubeStore.addCube(muc);
    }

    public async makeNewCube(message: string = "Hello Verity", replyto?: string) {
        for (let i = 0; i < 1; i++) {
            for (let j = 0; j < 1; j++) {
                let cube = new Cube();

                const messagebuffer: Buffer = Buffer.from(message, 'utf8');
                let cubefields: Array<fp.Field> = [
                    {
                        type: FieldType.PAYLOAD,
                        length: messagebuffer.length,
                        value: messagebuffer,
                    }
                ];

                if (replyto) {
                    cubefields.push({
                        type: FieldType.RELATES_TO,
                        length: 32,
                        value: Buffer.from(replyto, 'hex').slice(0, 32),
                    });
                }

                cube.setFields(cubefields);
                this.cubeStore.addCube(cube);
            }
        }
    }
}

declare var node: fullNode;

async function main() {
    console.log("\x1b[36m" + vera + "\x1b[0m");
    logger.info('Starting full node');
    global.node = new fullNode()
    if (isBrowser) {
        window.global = global
    }

    await node.onlinePromise;
    logger.info("Node is online");

    await node.shutdownPromise;
}

main();
