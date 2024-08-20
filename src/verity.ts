Error.stackTraceLimit = Infinity;  // mooooaaaar stacktraces
import { Settings } from './core/settings';
import { SupportedTransports } from './core/networking/networkDefinitions';

import { Cube } from './core/cube/cube';
import { CubeField } from './core/cube/cubeField';
import { VerityNode, VerityNodeOptions, defaultInitialPeers } from "./core/verityNode";
import { AddressAbstraction } from './core/peering/addressing';

import { logger } from './core/logger';
import { vera } from './misc/vera';

import sodium, { KeyPair } from 'libsodium-wrappers-sumo'
import { Buffer } from 'buffer';
import { isBrowser, isNode, isWebWorker, isJsDom, isDeno } from "browser-or-node";
import { FileApplication } from './app/fileApplication';
import * as fs from 'fs/promises';
import { CubeType } from './core/cube/cube.definitions';

let readline: any;
let cmd;
if (isNode) {
  readline = await import('readline');
  cmd = await import('cmd-ts');
}

export type VerityCmdClientOptions = VerityNodeOptions & {
  keyPair?: KeyPair
}

class VerityCmdClient {
  public node: VerityNode;
  public onlinePromise: Promise<void> = undefined;
  private mucUpdateCounter: number = 0;

  constructor(readonly options: VerityCmdClientOptions) {
    // initialise options
    options.initialPeers ??= [];
    options.autoConnect ??= true;
    options.lightNode ??= false;
    options.peerExchange ??= true;
    options.announceToTorrentTrackers ??= true;
    options.inMemoryLevelDB ??= false;

    if (isNode) {  // Provide debugging hotkeys
      readline.emitKeypressEvents(process.stdin);
      if (process.stdin.isTTY) process.stdin.setRawMode(true);

      process.stdin.on('keypress', async (str, key) => {
        if (key && key.ctrl && key.name == 'c') process.exit();
        if (str === 's') logger.info('\n' + await this.node.networkManager.prettyPrintStats());
        if (str === 'm') this.updateMuc();
        if (str === 'c') this.makeNewCube();
        if (str === 'f') this.insertFile();
      });
    }

    if (isNode) {  // we expect this to only ever be run in NodeJS, but just to be safe
      // prepare online promise
      let onlinePromiseResolve: Function;
      this.onlinePromise = new Promise<void>(
        (resolve) => {onlinePromiseResolve = resolve});
      // Define command line arguments
      const parse = cmd.command({
        name: "verity",
        description: "Command line verity client, useful primarily as a sever node.\n" +
                     "Will start with default settings if no options are specified.\n" +
                     "Will start only with the specified features enabled if any options are specified.\n",
        args: {
          ws: cmd.option({
            type: cmd.number,
            long: "websocket",
            env: "WEBSOCKET",
            short: "w",
            description: "Listen for native WebSocket connections on specified TCP port",
            defaultValue: () => undefined,
          }),
          libp2p: cmd.multioption({
            type: cmd.array(cmd.string),
            long: "libp2p",
            env: "LIBP2P",
            short: "l",
            description: "If arguments is a number, start a libp2p WebSocket listener on specified TCP port, which also makes this node a WebRTC connection broker. Alternatively, argument can be a full libp2p multiaddr to listen on. You can provide multiple arguments for multiple listen addresses.",
            defaultValue: () => undefined,
          }),
          peer: cmd.multioption({
            type: cmd.array(cmd.string),
            long: "peer",
            short: 'p',
            description: "Initially connect to this peer",
            defaultValue: () => undefined,
          }),
          tracker: cmd.flag({
            type: cmd.boolean,
            long: "tracker",
            short: 't',
            description: "Use Torrent trackers to find peers and announce our presence",
          }),
          nopersist: cmd.flag({
            type: cmd.boolean,
            long: "no-persist",
            description: "Turn off persistance. All cubes will be gone once you shut down this instance, unless of course they have been transmitted to instances with persistance turned on.",
            defaultValue: () => false
          }),
          pubaddr: cmd.option({
            type: cmd.string,
            long: "pubaddr",
            env: "pubaddr",
            description: "Specify this node's publicly reachable address, useful if behind NAT.",
            defaultValue: () => undefined,
          })
        },
        handler: ({ ws, libp2p, peer, tracker, nopersist, pubaddr }) => {
          if (!ws && !libp2p && !peer && !tracker && !nopersist && !pubaddr) {
            // use defaults if no options specified neither on the command line nor on construction
            logger.info("Note: Will start with default settings as you did not specify any command line options. Use --help for options.")
            if (!options.transports) {
              options.transports = new Map();
              options.transports.set(SupportedTransports.ws, Settings.DEFAULT_WS_PORT);
              options.transports.set(SupportedTransports.libp2p, Settings.DEFAULT_LIBP2P_PORT);
            }
            options.initialPeers ??= defaultInitialPeers;
          } else {
            // Print useful warnings in case of strange config choices
            if (!ws && !libp2p) {
              logger.warn("Note: You have started this node without any of --websocketport and --webrtcport. This node will not be able to receive any incoming connections.");
            }
            if (!peer && !tracker) {
              logger.warn("Note: You have started this node without any of --peer and --tracker. I will still start up, but make no effort to connect to anybody else. Your exprience might be quite limited.")
            }
            // Apply config
            options.transports = new Map();
            if (libp2p) options.transports.set(SupportedTransports.libp2p, libp2p);
            if (ws) options.transports.set(SupportedTransports.ws, ws);
            if (peer) {
              for (const onepeer of peer) {
                const addr = new AddressAbstraction(onepeer);
                options.initialPeers.push(addr);
              }
            }
            if (!ws) tracker = false;  // can't use Torrent trackers w/o native server capability
            options.announceToTorrentTrackers = tracker;
            options.publicAddress = pubaddr;
            if (nopersist) {
              options.inMemoryLevelDB = true;
              logger.warn("Note: Persistance has been turned off. All cubes will be gone once you shut down this instance, unless of course they have been transmitted to instances with persistance turned on.");
            }
          }
          this.node = new VerityNode(options);
          this.node.onlinePromise.then(() => onlinePromiseResolve(undefined));
        },
      });
      cmd.run(parse, process.argv.slice(2));
    } else {  // if this is not NodeJS, which is really strange indeed
      this.node = new VerityNode(options);
      this.onlinePromise = this.node.onlinePromise;
    }
  }

  /** Just for manual testing: Handler for the 'm' hotkey */
  public async updateMuc() {
    if (!this.options.keyPair) {
      logger.error("VerityCmdClient has been constructed without a key pair, cannot test MUC");
      return;
    }
    // write counter to buffer in ascii text
    const counterBuffer: Buffer = Buffer.alloc(8);
    counterBuffer.write(this.mucUpdateCounter.toString(), 0, 8, 'ascii');
    this.mucUpdateCounter++;
    // concat buffer with message
    const messageBuffer = Buffer.concat(
      [Buffer.from("Hello MUC: ", 'utf8'), counterBuffer]);
    const muc = Cube.MUC(
      Buffer.from(this.options.keyPair.publicKey),
      Buffer.from(this.options.keyPair.privateKey),
      {fields: CubeField.RawContent(CubeType.MUC, messageBuffer)}
    );
    this.node.cubeStore.addCube(muc);
  }

  /** Just for manual testing: Handler for the 'c' hotkey */
  public async makeNewCube(message: string = "Hello Verity") {
    const cube = Cube.Frozen({fields: CubeField.RawContent(CubeType.FROZEN, message)});
    this.node.cubeStore.addCube(cube);
  }

  public async insertFile(filePath: string = "test.file") {
    try {
      const fileContent = await fs.readFile(filePath);
      const fileName = filePath.split('/').pop() || filePath;
      const cubes = await FileApplication.createFileCubes(fileContent, fileName);
      if (cubes.length > 0) {
        const firstCubeKey = await cubes[0].getKey();
        for (const cube of cubes) {
          await this.node.cubeStore.addCube(cube);
        }
        logger.info(`File ${fileName} inserted into the network`);
        logger.info(`Cube key to retrieve the file: ${firstCubeKey.toString('hex')}`);
      } else {
        logger.warn(`No cubes created for file ${fileName}`);
      }
    } catch (error) {
      logger.error(`Error inserting file: ${error.message}`);
    }
  }
}


async function main() {
  console.log("\x1b[36m" + vera + "\x1b[0m");
  logger.info('Starting full node');

  await sodium.ready;
  const keyPair = sodium.crypto_sign_keypair();

  const client = new VerityCmdClient({ keyPair: keyPair});
  await client.onlinePromise;
  logger.info("Node is online");

  await client.node.shutdownPromise;
  logger.info("Node shut down");
}

main();
