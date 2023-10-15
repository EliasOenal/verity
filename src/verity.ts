Error.stackTraceLimit = Infinity;  // mooooaaaar stacktraces
import { Settings } from './core/settings';
import { SupportedTransports } from './core/networkDefinitions';

import { Cube } from './core/cube';
import { CubeField, CubeRelationship, CubeFields, CubeRelationshipType } from './core/cubeFields';
import { VerityNode } from "./core/verityNode";
import { AddressAbstraction } from './core/peerDB';

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
    let initialPeers: AddressAbstraction[] = [
        // new AddressAbstraction("verity.hahn.mt:1984"),
        // new AddressAbstraction("/dnsaddr/verity.hahn.mt/tcp/1984/ws"),
        // new AddressAbstraction("verity.hahn.mt:1985"),
        // new AddressAbstraction("verity.hahn.mt:1986"),
        // new AddressAbstraction("132.145.174.233:1984"),
        // new AddressAbstraction("158.101.100.95:1984"),
    ];

    if (isNode) {
      // prepare online promise
      let onlinePromiseResolve: Function;
      this.onlinePromise = new Promise<void>(
        (resolve) => {onlinePromiseResolve = resolve});
      // parse command line arguments
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
          webrtc: cmd.option({
            type: cmd.number,
            long: "libp2p",
            env: "LIBP2P",
            short: "l",
            description: "Start a libp2p WebSocket listener on specified TCP port, which also makes this node a WebRTC connection broker.",
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
          nopersist: cmd.flag({
            type: cmd.boolean,
            long: "no-persist",
            description: "Turn off persistance. All cubes will be gone once you shut down this instance, unless of course they have been transmitted to instances with persistance turned on.",
            defaultValue: () => false
          })
        },
        handler: ({ ws, webrtc, peer, tracker, nopersist }) => {
          let servers = new Map();
          // use defaults if no options specified
          if (!ws && !webrtc && !peer.length && !tracker && !nopersist) {
            logger.info("Note: Will start with default settings as you did not specify any command line options. Use --help for options.")
            servers.set(SupportedTransports.ws, Settings.DEFAULT_WS_PORT);
            servers.set(SupportedTransports.libp2p, Settings.DEFAULT_LIBP2P_PORT);
            // default initial peers already specified above
            tracker = true;
            nopersist = false;
          } else {
            if (!ws && !webrtc) {
              logger.warn("Note: You have started this node without any of --websocketport and --webrtcport. This node will not be able to receive any incoming connections.");
            }
            if (!peer.length && !tracker) {
              logger.warn("Note: You have started this node without any of --peer and --tracker. I will still start up, but make no effort to connect to anybody else. Your exprience might be quite limited.")
            }
            if (webrtc) servers.set(SupportedTransports.libp2p, webrtc);
            if (ws) servers.set(SupportedTransports.ws, ws);
            if (peer.length) {
              initialPeers = [];
              for (const onepeer of peer) {
                const addr = new AddressAbstraction(onepeer);
                initialPeers.push(addr);
              }
            }
            if (!ws) tracker = false;  // can't use Torrent trackers w/o native server capability
            if (nopersist) logger.warn("Note: Persistance has been turned off. All cubes will be gone once you shut down this instance, unless of course they have been transmitted to instances with persistance turned on.");
          }
          this.node = new VerityNode(servers, initialPeers,
            {
              announceToTorrentTrackers: tracker,
              enableCubePersistance: !nopersist,
              autoConnect: true,
              lightNode: false,
              peerExchange: true,
            });
          this.node.onlinePromise.then(() => onlinePromiseResolve(undefined));
        },
      });
      cmd.run(parse, process.argv.slice(2));
    } else {
      this.node = new VerityNode(
        new Map(), initialPeers,
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
