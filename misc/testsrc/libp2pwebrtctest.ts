/*
https://github.com/libp2p/js-libp2p/issues/2425
WebRTC transport apparently broken in the NodeJS environment

- **Version**:
```
$ npm ls | grep libp2p
├── @chainsafe/libp2p-noise@15.0.0
├── @chainsafe/libp2p-yamux@6.0.2
├── @libp2p/circuit-relay-v2@1.0.15
├── @libp2p/identify@1.0.14
├── @libp2p/mplex@10.0.15
├── @libp2p/webrtc@4.0.19
├── @libp2p/websockets@8.0.15
├── libp2p@1.2.3
```

- **Platform**:
```
$ uname -a
Linux schnippi 5.15.0-97-generic #107~20.04.1-Ubuntu SMP Fri Feb 9 14:20:11 UTC 2024 x86_64 x86_64 x86_64 GNU/Linux
```

- **Subsystem**:
WebRTC / circuit-relay-transport

#### Severity:
Medium

#### Description:
The WebRTC transport does not seem to function correctly within the NodeJS environment. While it is obviously intended for the browser environment and not NodeJS, that means that in a usual setup any jest tests for a web project will misbehave in very strange ways:

- WebRTC connections do not actually seem to be independent WebRTC connections but rather keep relying on the brokering circuit-relay-server, even though their transient flag is false. Once the server goes away, the "WebRTC" connection fails.

- Once we initiate any WebRTC connection, the nodes do not shut down cleanly anymore, i.e. NodeJS does not terminate.

#### Steps to reproduce the error:
Here's a minimal test case:
1) In a TypeScript file to be run e.g. with `npx tsx`, we create three libp2p nodes, a "server" (i.e. a node listening on a dialable address) and two "browser" nodes (i.e. not listening on any dialable address but simply on '/webrtc').

2) We then proceed to connect both "browsers" to the "server" and reserve circuit-relay-transport slots for the browsers at the server.

3) After that, we initiate a WebRTC connection between the two browsers. Through this connection, we send a message directly from browser1 to browser2.

4) We then shut down the server and send another message from browser1 to browser2.

5) Finally, we shut down the browser nodes to end the test.

Expected behavior:
1) Both messages sent through the WebRTC connection from browser1 to browser2 should arrive.
2) NodeJS should terminate at the end of the test.

Actual behaviour:
1) While the message sent from browser1 to browser2 while the server is still running arrives, the one send after the server was shut down does not.
2) NodeJS does not terminate even after all three nodes have been shut down.

Test code:
*/

import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { webRTC, webRTCDirect } from "@libp2p/webrtc";
import { webSockets } from "@libp2p/websockets";
import { createLibp2p } from "libp2p";
import { circuitRelayTransport, circuitRelayServer } from "@libp2p/circuit-relay-v2";
import { identify } from "@libp2p/identify";
import { Libp2pNode } from "libp2p/libp2p";
import * as filters from '@libp2p/websockets/filters'
import type { IncomingStreamData } from '@libp2p/interface/src/stream-handler'
import { Connection, Stream } from '@libp2p/interface/src/connection'
import { multiaddr, Multiaddr } from '@multiformats/multiaddr'
import { Buffer } from 'buffer';
import { lpStream, LengthPrefixedStream } from 'it-length-prefixed-stream'
import { Uint8ArrayList } from 'uint8arraylist'

async function main() {
  // create three nodes, one "server" (listening node) and two "browsers" (non-listening)
  const server = await createLibp2p({
    addresses: {listen: ['/ip4/127.0.0.1/tcp/31337/ws']},
    transports: [
      webSockets({filter: filters.all}),
      webRTC(),
      circuitRelayTransport(),
    ],
    connectionEncryption: [noise()],
    streamMuxers: [yamux()],
    services: {
      identify: identify(),
      relay: circuitRelayServer(),
    },
    connectionGater: {
      denyDialPeer: async () => false,
      denyDialMultiaddr: async() => false,
      filterMultiaddrForPeer: async() => true,
    },
    connectionManager: {minConnections: 0}
  }) as unknown as Libp2pNode;  // receiving unexpected type from createLibp2p
  server['name'] = "server";  // just for test output
  await server.start();
  await server.handle("/verity/1.0.0",
    (incomingStreamData: IncomingStreamData) => handleIncoming(incomingStreamData, server));

  const browser1 = await createLibp2p({
    addresses: {listen: ['/webrtc']},
    transports: [
      webSockets({filter: filters.all}),
      webRTC(),
      circuitRelayTransport(),
    ],
    connectionEncryption: [noise()],
    streamMuxers: [yamux()],
    services: {
      identify: identify(),
    },
    connectionGater: {
      denyDialPeer: async () => false,
      denyDialMultiaddr: async() => false,
      filterMultiaddrForPeer: async() => true,
    },
    connectionManager: {minConnections: 0}
  }) as unknown as Libp2pNode;  // receiving unexpected type from createLibp2p
  browser1['name'] = "browser1";  // just for test output
  await browser1.start();
  await browser1.handle("/verity/1.0.0",
    (incomingStreamData: IncomingStreamData) => handleIncoming(incomingStreamData, browser1));
  const b1crt: any = browser1.components.transportManager.
    getTransports().find( (transport) => 'reservationStore' in transport);
  assert(b1crt !== undefined);

  const browser2 = await createLibp2p({
    addresses: {listen: ['/webrtc']},
    transports: [
      webSockets({filter: filters.all}),
      webRTC(),
      circuitRelayTransport(),
    ],
    connectionEncryption: [noise()],
    streamMuxers: [yamux()],
    services: {
      identify: identify(),
    },
    connectionGater: {
      denyDialPeer: async () => false,
      denyDialMultiaddr: async() => false,
      filterMultiaddrForPeer: async() => true,
    },
    connectionManager: {minConnections: 0}
  }) as unknown as Libp2pNode;  // receiving unexpected type from createLibp2p
  await browser2.start();
  browser2['name'] = "browser2";  // just for test output
  await browser2.start();
  await browser2.handle("/verity/1.0.0",
    (incomingStreamData: IncomingStreamData) => handleIncoming(incomingStreamData, browser2));
  const b2crt: any = browser2.components.transportManager.
    getTransports().find( (transport) => 'reservationStore' in transport);
  assert(b2crt !== undefined);

  // connect both "browsers" to the server
  const b1ToServer: Connection = await browser1.dial(multiaddr('/ip4/127.0.0.1/tcp/31337/ws'));
  const b2ToServer: Connection = await browser2.dial(multiaddr('/ip4/127.0.0.1/tcp/31337/ws'));

  assert(server.getConnections().length == 2);
  assert(browser1.getConnections().length == 1);
  assert(browser2.getConnections().length == 1);

  // register circuit relay for both browsers
  b1crt.reservationStore.addRelay(b1ToServer.remotePeer, "configured");
  b2crt.reservationStore.addRelay(b2ToServer.remotePeer, "configured");
  await new Promise(resolve => setTimeout(resolve, 100));  // give it some time

  // both browsers should now have a dialable p2p-circuit/webRTC addr
  let browser1dialable: Multiaddr = undefined;
  let browser2dialable: Multiaddr = undefined;

  // check for a dialable p2p-circuit/webRTC addr at browser1
  for (const multiaddr of browser1.getMultiaddrs()) {
    const protos: string[] = multiaddr.protoNames();
     if (protos.includes("p2p") && protos.includes("p2p-circuit") && protos.includes("webrtc")) {
      browser1dialable = multiaddr;
    }
  }
  assert(browser1dialable !== undefined);
  console.log("browser1's dialable address is: " + browser1dialable)

  // check for a dialable p2p-circuit/webRTC addr at browser2
  for (const multiaddr of browser2.getMultiaddrs()) {
    const protos: string[] = multiaddr.protoNames();
     if (protos.includes("p2p") && protos.includes("p2p-circuit") && protos.includes("webrtc")) {
      browser2dialable = multiaddr;
    }
  }
  assert(browser2dialable !== undefined);
  console.log("browser2's dialable address is: " + browser2dialable)

  // connect browser1 to browser2
  const b1ToB2: Connection = await browser1.dial(browser2dialable);
  assert(b1ToB2.transient === false);
  assert(b1ToB2.status === "open");

  const b1b2rawstream: Stream = await b1ToB2.newStream("/verity/1.0.0");
  const b1tob2stream: LengthPrefixedStream = lpStream(b1b2rawstream);
  console.log("Sending message from browser1 to browser2");
  await b1tob2stream.write(Buffer.from("Message from browser1 while server still connected", 'utf8'));
  await new Promise(resolve => setTimeout(resolve, 100));  // give it some time

  console.log("Stopping server");
  await server.stop();

  console.log("Sending message from browser1 to browser2 after server stopped");
  b1tob2stream.write(Buffer.from("Message from browser1 after server disconnected", 'utf8'));
  await new Promise(resolve => setTimeout(resolve, 1000));  // give it some time

  console.log("teardown: stopping browser nodes");
  await browser1.stop();
  await browser2.stop();
  console.log("end of main, NodeJS should terminate now");
}

async function handleIncoming(incomingStreamData: IncomingStreamData, node) {
  console.log("handling incoming stream at " + node.name)
  const stream: LengthPrefixedStream = lpStream(incomingStreamData.stream);
  let msg: Uint8ArrayList;
  try {
    while (msg = await stream.read()) {
      const msgBuf: Buffer = Buffer.from(
        msg.subarray()  // Note: Here, subarray() re-assembles a message which
                        // may have been received in many fragments.
      );
      console.log(`Message received at ${node.name}: ${msgBuf.toString('utf8')}`);
    }
  } catch(error) {
    console.log("error reading stream at " + node.name + ": " + error);
  }
  console.log("stopping to handle stream at " + node.name)
}

function assert(assertion: boolean) {
  if (!assertion) throw Error("assertion failed");
}

main();
