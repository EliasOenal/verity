// Add Promise.withResolvers polyfill for Node.js 20 compatibility
import 'promise.withresolvers/auto';

import { describe, it, expect } from 'vitest';
import { CoreNode } from '../../../src/core/coreNode';
import { SupportedTransports } from '../../../src/core/networking/networkDefinitions';
import { AddressAbstraction } from '../../../src/core/peering/addressing';
import { Cube } from '../../../src/core/cube/cube';
import { CubeField } from '../../../src/core/cube/cubeField';
import { CubeType, NotificationKey, CubeFieldType } from '../../../src/core/cube/cube.definitions';
import { testCoreOptions } from '../testcore.definition';
import { Buffer } from 'buffer';
import { Libp2pTransport } from '../../../src/core/networking/transport/libp2p/libp2pTransport';

describe('WebRTC-Direct end-to-end connectivity with Verity nodes', () => {
  it('should configure WebRTC-Direct transport and verify multiaddrs', async () => {
    // Create node configured with libp2p transport
    // WebRTC-Direct is enabled by default on Node.js in Verity's libp2p configuration
    const node: CoreNode = new CoreNode({
      ...testCoreOptions,
      lightNode: false,
      transports: new Map([
        [SupportedTransports.libp2p, 16001],
      ]),
    });
    
    await node.readyPromise;
    
    // Give the transport some time to start up properly
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get the node's transport and verify WebRTC-Direct configuration
    const nodeTransport = node.networkManager.transports.get(SupportedTransports.libp2p) as Libp2pTransport;
    expect(nodeTransport).toBeDefined();
    
    const multiaddrs = nodeTransport!.node.getMultiaddrs();
    console.log('Node multiaddrs:', multiaddrs.map(ma => ma.toString()));
    
    // Verify WebRTC-Direct addresses are present (enabled by default on Node.js)
    const webrtcDirectAddrs = multiaddrs.filter(ma => 
      ma.toString().includes('/webrtc-direct/') && ma.toString().includes('/certhash/'));
    
    expect(webrtcDirectAddrs.length).toBeGreaterThan(0);
    console.log('WebRTC-Direct addresses found:', webrtcDirectAddrs.map(ma => ma.toString()));
    
    // Verify address format
    const webrtcDirectAddr = webrtcDirectAddrs[0];
    expect(webrtcDirectAddr.toString()).toMatch(/\/ip4\/[\d\.]+\/udp\/\d+\/webrtc-direct\/certhash\/[a-zA-Z0-9_-]+\/p2p\/[a-zA-Z0-9]+/);
    
    await node.shutdown();
  }, 8000);

  it('should establish WebRTC-Direct connection and transmit cubes between Verity nodes', async () => {
    // Create listener node with WebRTC-Direct enabled (default on Node.js)
    const listener: CoreNode = new CoreNode({
      ...testCoreOptions,
      lightNode: false,
      transports: new Map([
        [SupportedTransports.libp2p, 16005], 
      ]),
    });
    await listener.readyPromise;

    // Wait for transport to start
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get WebRTC-Direct address
    const listenerTransport = listener.networkManager.transports.get(SupportedTransports.libp2p) as Libp2pTransport;
    const multiaddrs = listenerTransport!.node.getMultiaddrs();
    const webrtcDirectAddr = multiaddrs.find(ma => 
      ma.toString().includes('/webrtc-direct/') && ma.toString().includes('/certhash/'));
    
    // Verify WebRTC-Direct is configured
    expect(webrtcDirectAddr).toBeDefined();
    expect(webrtcDirectAddr!.toString()).toContain('/webrtc-direct/');
    console.log('Using WebRTC-Direct address for connection:', webrtcDirectAddr!.toString());

    // Create dialer node and attempt actual connection
    const dialer: CoreNode = new CoreNode({
      ...testCoreOptions,
      lightNode: true,
      transports: new Map([
        [SupportedTransports.libp2p, 16006],
      ]),
      // Use WebRTC-Direct address as initial peer
      initialPeers: [new AddressAbstraction(webrtcDirectAddr!.toString())],
    });

    await dialer.readyPromise;

    // Attempt to establish connection
    await Promise.race([
      dialer.onlinePromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 5000))
    ]);
    
    // Verify connection was established
    expect(dialer.networkManager.onlinePeers.length).toBeGreaterThan(0);
    expect(listener.networkManager.onlinePeers.length).toBeGreaterThan(0);
    console.log('WebRTC-Direct connection established successfully');
    
    // Test cube transmission over WebRTC-Direct
    const testCube = Cube.Frozen({
      fields: [
        CubeField.RawContent(CubeFieldType.FROZEN_RAWCONTENT, "WebRTC-Direct e2e test message"),
      ],
      requiredDifficulty: 0,
    });
    
    await listener.cubeStore.addCube(testCube);
    
    // Retrieve cube over WebRTC-Direct connection
    const retrievedCube = await Promise.race([
      dialer.cubeRetriever.getCube(testCube.getKeyIfAvailable()!),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Cube retrieval timeout')), 3000))
    ]);
    
    expect(retrievedCube).toBeDefined();
    expect((retrievedCube as Cube).getKeyIfAvailable()).toEqual(testCube.getKeyIfAvailable());
    console.log('Successfully transmitted cube over WebRTC-Direct connection');
    
    await Promise.all([
      listener.shutdown(),
      dialer.shutdown(),
    ]);
  }, 12000);

  it('should create WebRTC-Direct-capable nodes for notification delivery', async () => {
    // Create sender node with WebRTC-Direct enabled (default on Node.js)
    const sender: CoreNode = new CoreNode({
      ...testCoreOptions,
      lightNode: true,
      transports: new Map([
        [SupportedTransports.libp2p, 16007], 
      ]),
    });
    await sender.readyPromise;

    // Create recipient node with WebRTC-Direct enabled (default on Node.js)
    const recipient: CoreNode = new CoreNode({
      ...testCoreOptions, 
      lightNode: true,
      transports: new Map([
        [SupportedTransports.libp2p, 16008], 
      ]),
    });
    await recipient.readyPromise;

    // Give transports time to start
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify both nodes have WebRTC-Direct capability
    const senderTransport = sender.networkManager.transports.get(SupportedTransports.libp2p) as Libp2pTransport;
    const recipientTransport = recipient.networkManager.transports.get(SupportedTransports.libp2p) as Libp2pTransport;
    
    expect(senderTransport).toBeDefined();
    expect(recipientTransport).toBeDefined();
    
    const senderAddrs = senderTransport!.node.getMultiaddrs();
    const recipientAddrs = recipientTransport!.node.getMultiaddrs();
    
    const senderWebRTCDirect = senderAddrs.find(ma => ma.toString().includes('/webrtc-direct/'));
    const recipientWebRTCDirect = recipientAddrs.find(ma => ma.toString().includes('/webrtc-direct/'));
    
    expect(senderWebRTCDirect).toBeDefined();
    expect(recipientWebRTCDirect).toBeDefined();
    
    console.log('Sender WebRTC-Direct addr:', senderWebRTCDirect?.toString());
    console.log('Recipient WebRTC-Direct addr:', recipientWebRTCDirect?.toString());
    
    // Verify both nodes are capable of WebRTC-Direct connectivity for notifications
    expect(senderWebRTCDirect!.toString()).toMatch(/\/webrtc-direct\/certhash\//);
    expect(recipientWebRTCDirect!.toString()).toMatch(/\/webrtc-direct\/certhash\//);
    
    console.log('Both nodes successfully configured with WebRTC-Direct capability');

    await Promise.all([
      sender.shutdown(),
      recipient.shutdown(),
    ]);
  }, 6000);
});