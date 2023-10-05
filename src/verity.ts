Error.stackTraceLimit = Infinity;

import { isBrowser, isNode, isWebWorker, isJsDom, isDeno } from "browser-or-node";

import { Cube } from './core/cube';
import { CubeField, CubeRelationship, CubeFields, CubeRelationshipType } from './core/cubeFields';
import { VerityNode } from "./core/verityNode";
import { SupportedServerTypes } from './core/networkServer';

import { logger } from './core/logger';
import { vera } from './misc/vera';

import sodium, { KeyPair } from 'libsodium-wrappers'
import { Buffer } from 'buffer';

let readline: any;
let cmd;
if (isNode) {
  readline = await import('readline');
  cmd = await import('cmd-ts');
}

class VerityCmdClient {
  public node: VerityNode;
  public onlinePromise: Promise<void> = undefined;
  private mucUpdateCounter: number = 0;

  constructor(private keyPair: KeyPair) {
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
    let initialPeers = [
        // "verity.hahn.mt:1984",
        // "verity.hahn.mt:1985",
        // "verity.hahn.mt:1986",
        // "132.145.174.233:1984",
        // "158.101.100.95:1984",
    ];

    if (isNode) {
      // prepare online promise
      let onlinePromiseResolve: Function;
      this.onlinePromise = new Promise<void>(
        (resolve) => {onlinePromiseResolve = resolve});
      // parse command line arguments
      const parse = cmd.command({
        name: "Verity",
        args: {
          ws: cmd.option({
            type: cmd.number,
            long: "websocketport",
            env: "WEBSOCKETPORT",
            short: "w",
            description: "Listen for native WebSocket connections on specified TCP port",
            defaultValue: () => undefined,
          }),
          webrtc: cmd.option({
            type: cmd.number,
            long: "webrtcport",
            env: "WEBRTCPORT",
            short: "r",
            description: "Start a libp2p WebRTC listener on specified UDP port, as well as a relay server using the same port number for a corresponding TCP Websocket.",
            defaultValue: () => undefined,
          }),
          peer: cmd.multioption({
            type: cmd.array(cmd.string),
            long: "peer",
            short: 'p',
            description: "Initially connect to this peer"
          }),
          tracker: cmd.flag({
            type: cmd.boolean,
            long: "tracker",
            short: 't',
            description: "Use Torrent trackers to find peers and announce our presence",
          }),
        },
        handler: ({ ws, webrtc, peer, tracker }) => {
          let servers = new Map();
          if (ws) servers.set(SupportedServerTypes.ws, ws);
          if (webrtc) servers.set(SupportedServerTypes.libp2p, webrtc);
          if (peer.length) {
            initialPeers = [];
            for (const onepeer of peer) {
              initialPeers.push(onepeer);
            }
          }
          if (!ws) tracker = false;  // can't use Torrent trackers w/o native server capability
          this.node = new VerityNode(false, servers, initialPeers, tracker);
          this.node.onlinePromise.then(() => onlinePromiseResolve(undefined));
        },
      });
      cmd.run(parse, process.argv.slice(2));
    } else {
      this.node = new VerityNode(false, new Map(), initialPeers, false);
      this.onlinePromise = this.node.onlinePromise;
    }
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
      cubefields.appendField(CubeField.RelatesTo(
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
  const keyPair = sodium.crypto_sign_keypair();

  const client = new VerityCmdClient(keyPair);
  await client.onlinePromise;
  logger.info("Node is online");

  await client.node.shutdownPromise;
  logger.info("Node shut down");
}

main();
