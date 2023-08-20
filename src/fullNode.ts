import { isBrowser, isNode, isWebWorker, isJsDom, isDeno } from "browser-or-node";
import { NetworkManager } from './model/networkManager';
import { CubeStore } from './model/cubeStore';
import { PeerDB, Peer } from './model/peerDB';
import { logger } from './model/logger';
import { Cube } from './model/cube';
import { vera } from './misc/vera';
import sodium, { KeyPair } from 'libsodium-wrappers'
import { FieldType, Field, Fields } from './model/fieldProcessing';
import { EventEmitter } from 'events';
import { NetworkPeer } from "./model/networkPeer";
import * as fp from './model/fieldProcessing';
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
    networkManager: NetworkManager;
    onlinePromise: any = undefined;
    shutdownPromise: any = undefined;
    keyPair: KeyPair;
    mucUpdateCounter: number = 0;

    constructor() {
        let initialPeers = [
            "verity.hahn.mt:1984",
            // "verity.hahn.mt:1985",
            // "verity.hahn.mt:1986",
            // "132.145.174.233:1984",
            // "158.101.100.95:1984",
        ];

        this.keyPair = sodium.crypto_sign_keypair();
        if (isNode) {
            if (process.argv[2]) this.port = Number(process.argv[2]);
            if (process.argv[3]) initialPeers = [process.argv[3]];
        }

        let announceToTorrentTrackers: boolean;
        if (isNode) announceToTorrentTrackers = true;
        else announceToTorrentTrackers = false;

        this.networkManager = new NetworkManager(this.port, this.cubeStore, this.peerDB, announceToTorrentTrackers);

        if (initialPeers) {
            for (let i = 0; i < initialPeers.length; i++) {
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
                if (str === 'm') this.updateMuc();
                if (str === 'c') this.makeNewCube();
            });
        }
    }

    public async updateMuc() {
        const publicKey: Buffer = Buffer.from(this.keyPair.publicKey);
        const privateKey: Buffer = Buffer.from(this.keyPair.privateKey);
        let muc = new Cube();

        muc.setCryptoKeys(publicKey, privateKey);
        // buffer from number BE 32bit
        const messageBuffer: Buffer = Buffer.alloc(4);
        messageBuffer.writeUInt32BE(this.mucUpdateCounter);
        this.mucUpdateCounter++;

        const fields = new Fields([
            new Field(FieldType.TYPE_SMART_CUBE | 0b00, 0, Buffer.alloc(0)),
            new Field(FieldType.TYPE_PUBLIC_KEY, 32, publicKey),
            new Field(FieldType.PAYLOAD, 9, Buffer.from("Hello MUC", 'utf8')),
            new Field(FieldType.PAYLOAD, 4, messageBuffer),
            new Field(FieldType.PADDING_NONCE, 892, Buffer.alloc(892)),
            new Field(FieldType.TYPE_SIGNATURE, 72, Buffer.alloc(72))
        ]);

        muc.setFields(fields);
        this.cubeStore.addCube(muc);
    }

    public async makeNewCube(message: string = "Hello Verity", replyto?: string) {
        let cube = new Cube();
        const messagebuffer: Buffer = Buffer.from(message, 'utf8');
        let cubefields: Fields = new Fields(fp.Field.Payload(messagebuffer));

        if (replyto) {
            cubefields.data.push(fp.Field.RelatesTo(
                new fp.Relationship(fp.RelationshipType.REPLY_TO, Buffer.from(
                    replyto, 'hex'))));
        }

        cube.setFields(cubefields);
        this.cubeStore.addCube(cube);
    }
}

declare var node: fullNode;

async function main() {
    console.log("\x1b[36m" + vera + "\x1b[0m");
    logger.info('Starting full node');
    await sodium.ready;
    global.node = new fullNode()
    if (isBrowser) {
        // @ts-ignore
        window.webmain();
    }

    await node.onlinePromise;
    logger.info("Node is online");

    await node.shutdownPromise;
}

if (isBrowser) {
    window.global = global;
}
main();
