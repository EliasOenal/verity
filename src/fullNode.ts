// TODO: Rename this to commandlineclient.ts or something
// TODO: Include a proper argument parser, with non-positional args and all the nice stuff.
// TODO: Add command line argument to spawn a light client, currently only doing full nodes.

import { isBrowser, isNode, isWebWorker, isJsDom, isDeno } from "browser-or-node";

import { Cube } from './model/cube';
import { CubeField, CubeRelationship, CubeFields, CubeRelationshipType } from './model/cubeFields';
import { VerityNode } from "./model/verityNode";

import { logger } from './model/logger';
import { vera } from './misc/vera';

import sodium, { KeyPair } from 'libsodium-wrappers'
import { Buffer } from 'buffer';

let readline: any;
if (isNode) {
  readline = require('readline');
}

class VerityCmdClient {
  public node: VerityNode;
  private mucUpdateCounter: number = 0;
  private keyPair: KeyPair;

  constructor() {
    if (isNode) {  // Provide debugging hotkeys
      readline.emitKeypressEvents(process.stdin);
      if (process.stdin.isTTY) process.stdin.setRawMode(true);

      process.stdin.on('keypress', async (str, key) => {
        if (key && key.ctrl && key.name == 'c') process.exit();
        if (str === 's') logger.info('\n' + this.node.networkManager.prettyPrintStats());
        if (str === 'm') this.updateMuc();
        if (str === 'c') this.makeNewCube();
      });
    }

    // Use local port and initial peers supplied on the command line,
    // or these defaults:
    let port = 1984;
    let initialPeers = [
        "verity.hahn.mt:1984",
        // "verity.hahn.mt:1985",
        // "verity.hahn.mt:1986",
        // "132.145.174.233:1984",
        // "158.101.100.95:1984",
    ];
    if (isNode) {
        if (process.argv[2]) port = Number(process.argv[2]);
        if (process.argv[3]) initialPeers = [process.argv[3]];
    }

    let announceToTorrentTrackers: boolean;
    if (isNode) announceToTorrentTrackers = true;
    else announceToTorrentTrackers = false;

    this.node = new VerityNode(false, port, initialPeers, announceToTorrentTrackers);

  }

  public async updateMuc() {
    // write counter to buffer in ascii text
    const counterBuffer: Buffer = Buffer.alloc(8);
    counterBuffer.write(this.mucUpdateCounter.toString(), 0, 8, 'ascii');
    this.mucUpdateCounter++;
    // concat buffer with message
    const messageBuffer = Buffer.concat(
      [Buffer.from("Hello MUC: ", 'utf8'), counterBuffer]);
    const muc = Cube.MUC(
      Buffer.from(this.keyPair.publicKey),
      Buffer.from(this.keyPair.privateKey),
      CubeField.Payload(messageBuffer)
    );
    this.node.cubeStore.addCube(muc);
  }

  public async makeNewCube(message: string = "Hello Verity", replyto?: string) {
    const cube = new Cube();
    const messagebuffer: Buffer = Buffer.from(message, 'utf8');
    const cubefields: CubeFields = new CubeFields(CubeField.Payload(messagebuffer));

    if (replyto) {
      cubefields.data.push(CubeField.RelatesTo(
        new CubeRelationship(CubeRelationshipType.REPLY_TO, Buffer.from(
          replyto, 'hex'))));
    }

    cube.setFields(cubefields);
    this.node.cubeStore.addCube(cube);
  }
}


async function main() {
  console.log("\x1b[36m" + vera + "\x1b[0m");
  logger.info('Starting full node');
  await sodium.ready;

  const client = new VerityCmdClient;
  await client.node.onlinePromise;
  logger.info("Node is online");

  await client.node.shutdownPromise;
  logger.info("Node shut down");
}

main();
