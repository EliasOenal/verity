Error.stackTraceLimit = Infinity;  // mooooaaaar stacktraces
import { Settings } from './core/settings';
import { SupportedTransports } from './core/networking/networkDefinitions';

import { Cube } from './core/cube/cube';
import { CubeField, CubeFields } from './core/cube/cubeFields';
import { VerityNode } from "./core/verityNode";
import { AddressAbstraction } from './core/peering/addressing';

import { logger } from './core/logger';
import { vera } from './misc/vera';

import sodium, { KeyPair } from 'libsodium-wrappers'
import { Buffer } from 'buffer';
import { isBrowser, isNode, isWebWorker, isJsDom, isDeno } from "browser-or-node";

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

    // Default initial peers to use if none are supplied as command line options:
    let defaultInitialPeers: AddressAbstraction[] = [
        new AddressAbstraction("verity.hahn.mt:1984"),
        new AddressAbstraction("/dns4/verity.hahn.mt/tcp/1985/wss"),
        // new AddressAbstraction("verity.hahn.mt:1985"),
        // new AddressAbstraction("verity.hahn.mt:1986"),
        // new AddressAbstraction("132.145.174.233:1984"),
        // new AddressAbstraction("158.101.100.95:1984"),
    ];

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
          let servers = new Map();
          let peers: AddressAbstraction[] = [];
          if (!ws && !libp2p && !peer && !tracker && !nopersist && !pubaddr) {
            // use defaults if no options specified
            logger.info("Note: Will start with default settings as you did not specify any command line options. Use --help for options.")
            peers = defaultInitialPeers;
            servers.set(SupportedTransports.ws, Settings.DEFAULT_WS_PORT);
            servers.set(SupportedTransports.libp2p, Settings.DEFAULT_LIBP2P_PORT);
            tracker = true;
            nopersist = false;
          } else {
            // Print useful warnings in case of strange config choices
            if (!ws && !libp2p) {
              logger.warn("Note: You have started this node without any of --websocketport and --webrtcport. This node will not be able to receive any incoming connections.");
            }
            if (!peer && !tracker) {
              logger.warn("Note: You have started this node without any of --peer and --tracker. I will still start up, but make no effort to connect to anybody else. Your exprience might be quite limited.")
            }
            // Apply config
            if (libp2p) {
              servers.set(SupportedTransports.libp2p, libp2p);
            }
            if (ws) servers.set(SupportedTransports.ws, ws);
            if (peer) {
              for (const onepeer of peer) {
                const addr = new AddressAbstraction(onepeer);
                peers.push(addr);
              }
            }
            if (!ws) tracker = false;  // can't use Torrent trackers w/o native server capability
            if (nopersist) logger.warn("Note: Persistance has been turned off. All cubes will be gone once you shut down this instance, unless of course they have been transmitted to instances with persistance turned on.");
          }
          this.node = new VerityNode(servers, peers,
            {
              announceToTorrentTrackers: tracker,
              enableCubePersistance: !nopersist,
              autoConnect: true,
              lightNode: false,
              peerExchange: true,
              publicAddress: pubaddr,
            });
          this.node.onlinePromise.then(() => onlinePromiseResolve(undefined));
        },
      });
      cmd.run(parse, process.argv.slice(2));
    } else {  // if this is not NodeJS, which is really strange indeed
      this.node = new VerityNode(
        new Map(), defaultInitialPeers,
        {
          announceToTorrentTrackers: false,
          autoConnect: true,
          enableCubePersistance: true,
          lightNode: false,
          peerExchange: true,
        });
      this.onlinePromise = this.node.onlinePromise;
    }
  }

  /** Just for manual testing: Handler for the 'm' hotkey */
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

  /** Just for manual testing: Handler for the 'c' hotkey */
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
