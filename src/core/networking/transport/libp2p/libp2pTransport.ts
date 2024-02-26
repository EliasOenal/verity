import { Settings, VerityError } from "../../../settings";
import { Libp2pServer } from "./libp2pServer";
import { NetworkTransport } from "../networkTransport";
import { NetworkManager, NetworkManagerOptions } from "../../networkManager";
import { AddressAbstraction } from "../../../peering/addressing";
import { logger } from "../../../logger";

import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { webRTC, webRTCDirect } from "@libp2p/webrtc";
import { webSockets } from "@libp2p/websockets";
import { createLibp2p } from "libp2p";
import { circuitRelayTransport, circuitRelayServer } from "@libp2p/circuit-relay-v2";
import { identify } from "@libp2p/identify";
import { Libp2pNode } from "libp2p/libp2p";
import * as filters from '@libp2p/websockets/filters'
import { createServer } from 'https';
import { readFileSync } from 'fs';

import { isNode } from "browser-or-node";

// General libp2p TODOs:
// Fix node exchange, we're exchanging far too much crap
// Stop server nodes from reserving relay spots
// Use observed addresses after evaluating them through some sort of heuristic peer trust

// TODO: try to move more server/listener specific stuff into Libp2pServer
export class Libp2pTransport extends NetworkTransport {
  private listen: string[] = [];
  private _node: Libp2pNode;  // libp2p types are much to complicated for my humble brain
  public circuitRelayTransport: any = undefined;  // class CircuitRelayTransport not exported by lib
  get node() { return this._node }

  /**
   * Syntactic sugar to get this transport's TransportServer instance.
   * Due to libp2p's framework-heavy nature there's no clear-cut separation
   * between "server" (listening) and "client" (outgoing connection) code,
   * as both need the full framework (libp2p's Node object) initialized.
   */
  get server() { return this._servers[0] }

  constructor(
    private listen_param: string[] | number[] | string | number = 1985,
    private options: NetworkManagerOptions = {})
  {
    super();
    this._servers = [new Libp2pServer(this)];
    // construct listen string array
    if (!Array.isArray(listen_param)) listen_param = [listen_param as any];
    for (const listenSpec of listen_param) {
      if (!isNaN(listenSpec as number)) {  // if listen_param is a port number
        this.listen = this.listen.concat([
          `/ip4/0.0.0.0/tcp/${listen_param}/wss`,  // for relay... or WebSocket via libp2p
          // `/ip6/::1/tcp/${listen_param}/ws`,  // configuring IPv6 always throws "Listener not ready"... so no IPv6 I guess
          `/ip4/0.0.0.0/udp/${listen_param}/webrtc`,
          // `/ip6/::1/udp/${listen_param}/webrtc`,
        ]);
      } else if (typeof listenSpec === 'string' || listenSpec as any instanceof String) {
        this.listen.push(listenSpec as string);
      } else {
        throw new VerityError("Param type should be a multiaddr string or port number, but I got " + listenSpec);
      }
    }
    if (!this.listen.includes("/webrtc")) this.listen.push("/webrtc");
  }

  async start(): Promise<void> {
    // Pre-create libp2p components:
    let transports = [];
    // webSockets() transport object: Should we use HTTPs / WSS or plain text?
    if (isNode &&  // no listening allowed on the browser in any case
        (this.listen.some((listenString) =>  // any listen String calls for HTTPs
          // Note: this is a really ugly way to parse a Multiaddr, but as libp2p wants
          // a multiaddr *string* rather than a multiaddr object, this is easiest way
          listenString.includes("/wss") || listenString.includes("/tls")))) {
      const httpsServer = createServer({
        // TODO HACKHACK: do something other than hardcoding a cert file name.
        // Literally anything else.
        cert: readFileSync('./cert.pem'),
        key: readFileSync('./key.pem'),
      });
      transports.push(webSockets({
        filter: filters.all,  // allow all kinds of connections for testing, effectively disabling sanitizing - maybe TODO remove this?
        server: httpsServer,
      }));
    } else {
      transports.push(webSockets({
        filter: filters.all,  // allow all kinds of connections for testing, effectively disabling sanitizing - maybe TODO remove this?
      }));
    }
    // webRTC
    transports.push(webRTC({
      rtcConfiguration: {
        iceServers:[{
          // TODO get rid of third-party STUN servers
          // STUN is unfortunately needed in libp2p, apparently as they need to
          // rely on a standard/trusted protocol exposed through browser APIs.
          // Implement a STUN service on our full nodes maybe?
          urls: [
            'stun:stun.l.google.com:19302',
            'stun:global.stun.twilio.com:3478'
          ]
        }]
      }
    }));
    // relaying
    if (this.options.useRelaying) {
      transports.push(circuitRelayTransport());
    }
    // addressing (listen and possibly announce, which are basically public address override)
    const addresses = {
      listen: this.listen,
    };
    logger.trace("Libp2pServer: publicAddress " + this.options['publicAddress']);
    if (this.options?.publicAddress) {
      // TODO HACKHACK actually parse the provided address and combine them with the provided listeners
      addresses['announce'] = [`/dns4/${this.options.publicAddress}/tcp/1985/wss/`];
    }

    // Now that we preconfigured all the components, fire up the Libp2pNode object:
    logger.trace("Libp2pServer: Starting up requesting listeners " +  addresses.listen + " and announce " + addresses['announce']);
    this._node = await createLibp2p({
      addresses: addresses,
      transports: transports,
      connectionEncryption: [noise()],
      streamMuxers: [yamux()],
      services: {
        identify: identify(),  // finds out stuff like our own observed address and protocols supported by remote node
        relay: circuitRelayServer({
          reservations: {
            maxReservations: Settings.MAXIMUM_CONNECTIONS*100,  // maybe a bit much?
          }
        }),  // note browser nodes also offer relay services to their connected peers! TODO: we should make active use of that in peer exchange
      },
      connectionGater: {
        // allow all kinds of connections, especially loopback ones (for testing)
        // maybe TODO remove this later?
        denyDialPeer: async () => false,
        denyDialMultiaddr: async() => false,
        filterMultiaddrForPeer: async() => true,
      },
      connectionManager: {
        minConnections: 0,  // we manage creating new peer connections ourselves
      }
    }) as unknown as Libp2pNode;  // it's actually the class the lib creates, believe me
    await this.server.start();
    if (this.options.useRelaying) {
      this.circuitRelayTransport = this.node.components.transportManager.
        getTransports().find( (transport) => 'reservationStore' in transport);
        // ugly... I'd do instanceof, but CircuitRelayTransport is not exported
    }
  }

  async shutdown(): Promise<void> {
    await this.server.shutdown();
    await super.shutdown();
    return this.node.stop() as Promise<void>;
  }

  /**
   * Event handler getting called when our publicly reachable address might have
   * changed, ensuring our peers get updated on our reachable ("dialable") address.
   */
  // TODO: completely scrap this crap and rewrite it
  // We should rely on libp2p's observed addrs and confirm them using some
  // heuristic trust measure
  addressChange(): void {
    if (this.dialableAddress) {
      return;
      // It appears we already have a dialable address. Currently, a Peer (and
      // in the eyes of our peers, we are obviously a peer) can only have one
      // primary address, so we're done here.
      // TODO generalize, we *should* actually register relay addresses with
      // multiple relays and publish all of them
      // TODO: Unset this.dialableAddress when the relay node connection closes
      // TODO: This should take observed addresses (i.e. reported by peers)
      // into account for NAT traversal (this.node.components.addressManager.addObservedAddr())
      // TODO FIXME: This makes us prefer relayed connections even when a direct
      // route might be available.
    }
    for (const multiaddr of this.node.getMultiaddrs()) {
      const protos: string[] = multiaddr.protoNames();
       if (protos.includes("p2p") && protos.includes("p2p-circuit") &&
           protos.includes("webrtc")) {
        this.dialableAddress = new AddressAbstraction(multiaddr);
        this.emit("serverAddress", this.dialableAddress);
      }
    }
  }

  toString(): string {
    let ret: string = "";
    if (this._node) {
      if (this._node.getMultiaddrs().length) {
        ret = "Libp2pTransport ";
        for (let i=0; i<this._node.getMultiaddrs().length; i++) {
          ret += this.node.getMultiaddrs()[i]
          if (i<this._node.getMultiaddrs().length-1) ret += ', ';
        }
      } else {
        ret += "Libp2pTransport NOT having any multiaddrs";
      }
    } else {
      ret += "Lib2pTransport (not running)";
    }
    return ret;
  }
  toLongString(): string {
    let ret: string = "";
    if (this._node) {
      if (this._node.getMultiaddrs().length) {
        ret += "Libp2pTransport having multiaddrs:\n"
        for (const multiaddr of this._node.getMultiaddrs()) {
          ret += " - " + multiaddr.toString() + '\n';
        }
      } else {
        ret += "Libp2pTransport NOT having any multiaddrs";
      }

    }
    else {
      ret += "Lib2pTransport (not running)";
    }
    return ret;
  }
}