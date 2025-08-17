import type { NetworkPeerIf } from '../../../../src/core/networking/networkPeerIf';
import type { CubeSubscription } from '../../../../src/core/networking/cubeRetrieval/pendingRequest';

import { cciFamily, cciCube } from "../../../../src/cci/cube/cciCube";
import { FieldType } from "../../../../src/cci/cube/cciCube.definitions";
import { VerityField } from "../../../../src/cci/cube/verityField";
import { CubeKey } from "../../../../src/core/cube/cube.definitions";
import { Cube } from "../../../../src/core/cube/cube";
import { CubeStoreOptions, CubeStore } from "../../../../src/core/cube/cubeStore";
import { keyVariants } from '../../../../src/core/cube/keyUtil';
import { CubeInfo } from '../../../../src/core/cube/cubeInfo';

import { SupportedTransports } from "../../../../src/core/networking/networkDefinitions";
import { NetworkManager } from "../../../../src/core/networking/networkManager";
import { NetworkManagerOptions } from '../../../../src/core/networking/networkManagerIf';
import { NetworkPeer } from '../../../../src/core/networking/networkPeer';

import { WebSocketAddress } from "../../../../src/core/peering/addressing";
import { Peer } from "../../../../src/core/peering/peer";
import { PeerDB } from "../../../../src/core/peering/peerDB";

import sodium from 'libsodium-wrappers-sumo'
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

const reducedDifficulty = 0; // no hash cash for testing

describe('RequestScheduler multi-node subscription e2e tests', () => {
  const testCubeStoreParams: CubeStoreOptions = {
    inMemory: true,
    enableCubeRetentionPolicy: false,
    requiredDifficulty: 0,
    family: cciFamily,
  };
  const testNetworkingOptions: NetworkManagerOptions = {  // disable optional features
    announceToTorrentTrackers: false,
    autoConnect: false,
    lightNode: true,
    peerExchange: false,
    requestInterval: 10,  // one request every 10ms sounds about right
    requestTimeout: 1000,
  };
  let local: NetworkManager;
  let remote1: NetworkManager;
  let remote2: NetworkManager;

  beforeAll(async() => {
    await sodium.ready;
  })

  beforeEach(async() => {
    local = new NetworkManager(
      new CubeStore(testCubeStoreParams),
      new PeerDB(),
      {
        ...testNetworkingOptions,  // light node (subscriber)
        transports: new Map([[SupportedTransports.ws, 18301]]),
      },
    );
    remote1 = new NetworkManager(
      new CubeStore(testCubeStoreParams),
      new PeerDB(),
      {
        ...testNetworkingOptions,
        lightNode: false,  // full node (subscription provider)
        transports: new Map([[SupportedTransports.ws, 18302]]),
      },
    );
    remote2 = new NetworkManager(
      new CubeStore(testCubeStoreParams),
      new PeerDB(),
      {
        ...testNetworkingOptions,
        lightNode: false,  // second full node (subscription provider)
        transports: new Map([[SupportedTransports.ws, 18303]]),
      },
    );
    await Promise.all([
      local.cubeStore.readyPromise,
      remote1.cubeStore.readyPromise,
      remote2.cubeStore.readyPromise,
      local.start(),
      remote1.start(),
      remote2.start(),
    ]);
    
    // Connect local to both remotes
    const np1: NetworkPeerIf = local.connect(new Peer(new WebSocketAddress("localhost", 18302)));
    const np2: NetworkPeerIf = local.connect(new Peer(new WebSocketAddress("localhost", 18303)));
    await Promise.all([np1.onlinePromise, np2.onlinePromise]);
  });

  afterEach(async() => {
    await Promise.all([local.shutdown(), remote1.shutdown(), remote2.shutdown()]);
  });

  it('can subscribe to multiple full nodes for resilience', async () => {
    // Verify connections
    expect(local.outgoingPeers.length).toBe(2);
    expect(remote1.incomingPeers.length).toBe(1);
    expect(remote2.incomingPeers.length).toBe(1);

    // Create a test MUC on both remote nodes
    const keyPair = sodium.crypto_sign_keypair();
    let muc: Cube = cciCube.MUC(
      Buffer.from(keyPair.publicKey), Buffer.from(keyPair.privateKey),
      {
        requiredDifficulty: reducedDifficulty,
        fields: [
          VerityField.ContentName("Multi-node subscription test"),
          VerityField.Payload("initial content"),
        ]
      }
    );
    muc.setDate(1715704514);
    await remote1.cubeStore.addCube(muc);
    await remote2.cubeStore.addCube(muc);
    const mucKey: CubeKey = await muc.getKey();
    
    // Verify initial state
    expect(await local.cubeStore.getNumberOfStoredCubes()).toBe(0);
    expect(await remote1.cubeStore.getNumberOfStoredCubes()).toBe(1);
    expect(await remote2.cubeStore.getNumberOfStoredCubes()).toBe(1);

    // Subscribe to the MUC
    const subPromise: Promise<CubeSubscription> = local.scheduler.subscribeCube(mucKey);
    
    // Wait for cube to be received and subscription to complete
    await local.cubeStore.expectCube(mucKey);
    const subscription = await subPromise;
    
    // Verify subscription is established
    expect(local.scheduler.cubeAlreadySubscribed(mucKey)).toBe(true);
    expect(subscription).toBeDefined();
    expect(subscription.subscribedPeers).toBeDefined();
    
    // Verify we subscribed to multiple peers
    expect(subscription.subscribedPeers.length).toBe(2);
    
    // Verify both remotes registered the subscription
    expect(remote1.incomingPeers[0].cubeSubscriptions).toContain(keyVariants(mucKey).keyString);
    expect(remote2.incomingPeers[0].cubeSubscriptions).toContain(keyVariants(mucKey).keyString);
    
    // Update MUC on remote1
    muc.getFirstField(FieldType.PAYLOAD).value = Buffer.from("updated by remote1", 'ascii');
    muc.setDate(1715704520);
    await muc.compile();
    await remote1.cubeStore.addCube(muc);

    // Verify local receives update
    await new Promise(resolve => setTimeout(resolve, 300));
    expect((await local.cubeStore.getCube(mucKey)).getFirstField(
      FieldType.PAYLOAD).valueString).toBe("updated by remote1");

    // Update MUC on remote2 (later timestamp wins)
    muc.getFirstField(FieldType.PAYLOAD).value = Buffer.from("updated by remote2", 'ascii');
    muc.setDate(1715704525);
    await muc.compile();
    await remote2.cubeStore.addCube(muc);

    // Verify local receives the newer update
    await new Promise(resolve => setTimeout(resolve, 300));
    expect((await local.cubeStore.getCube(mucKey)).getFirstField(
      FieldType.PAYLOAD).valueString).toBe("updated by remote2");
  });

  it('subscription succeeds even when one full node rejects it', async () => {
    // Verify connections
    expect(local.outgoingPeers.length).toBe(2);
    expect(remote1.incomingPeers.length).toBe(1);
    expect(remote2.incomingPeers.length).toBe(1);

    // Create a test MUC only on remote1 (remote2 won't have it)
    const keyPair = sodium.crypto_sign_keypair();
    let muc: Cube = cciCube.MUC(
      Buffer.from(keyPair.publicKey), Buffer.from(keyPair.privateKey),
      {
        requiredDifficulty: reducedDifficulty,
        fields: [
          VerityField.ContentName("Partial subscription test"),
          VerityField.Payload("only on remote1"),
        ]
      }
    );
    muc.setDate(1715704514);
    await remote1.cubeStore.addCube(muc);
    // Note: NOT adding to remote2
    const mucKey: CubeKey = await muc.getKey();
    
    // Verify initial state
    expect(await local.cubeStore.getNumberOfStoredCubes()).toBe(0);
    expect(await remote1.cubeStore.getNumberOfStoredCubes()).toBe(1);
    expect(await remote2.cubeStore.getNumberOfStoredCubes()).toBe(0);

    // Subscribe to the MUC - should succeed with partial success
    const subPromise: Promise<CubeSubscription> = local.scheduler.subscribeCube(mucKey);
    
    // Wait for cube to be received and subscription to complete
    await local.cubeStore.expectCube(mucKey);
    const subscription = await subPromise;
    
    // Verify subscription is established despite one node not having the cube
    expect(local.scheduler.cubeAlreadySubscribed(mucKey)).toBe(true);
    expect(subscription).toBeDefined();
    expect(subscription.subscribedPeers).toBeDefined();
    
    // Should have at least one successful subscription
    expect(subscription.subscribedPeers.length).toBeGreaterThanOrEqual(1);
    
    // Verify at least remote1 registered the subscription
    expect(remote1.incomingPeers[0].cubeSubscriptions).toContain(keyVariants(mucKey).keyString);
  });
});