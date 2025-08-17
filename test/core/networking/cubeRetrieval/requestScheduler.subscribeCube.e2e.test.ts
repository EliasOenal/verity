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

describe('RequestScheduler subscribeCube() e2e tests', () => {
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
  let remote: NetworkManager;

  beforeAll(async() => {
    await sodium.ready;
  })

  beforeEach(async() => {
    local = new NetworkManager(
      new CubeStore(testCubeStoreParams),
      new PeerDB(),
      {
        ...testNetworkingOptions,  // light node (subscriber)
        transports: new Map([[SupportedTransports.ws, 18201]]),
      },
    );
    remote = new NetworkManager(
      new CubeStore(testCubeStoreParams),
      new PeerDB(),
      {
        ...testNetworkingOptions,
        lightNode: false,  // full node (subscription provider)
        transports: new Map([[SupportedTransports.ws, 18202]]),
      },
    );
    await Promise.all([
      local.cubeStore.readyPromise,
      remote.cubeStore.readyPromise,
      local.start(),
      remote.start(),
    ]);
    const np: NetworkPeerIf =
      local.connect(new Peer(new WebSocketAddress("localhost", 18202)));
    await np.onlinePromise;
  });

  afterEach(async() => {
    await Promise.all([local.shutdown(), remote.shutdown()]);
  });

  it('can subscribe to updates for a locally present MUC', async () => {
    // assert remote is connected to local -- we'll use the NetworkPeer object
    // for some checks later
    expect(remote.incomingPeers.length).toEqual(1);
    const remoteToLocal: NetworkPeerIf = remote.incomingPeers[0];
    expect(remoteToLocal).toBeInstanceOf(NetworkPeer);

    // create a test MUC
    const keyPair = sodium.crypto_sign_keypair();
    let muc: Cube = cciCube.MUC(
      Buffer.from(keyPair.publicKey), Buffer.from(keyPair.privateKey),
      {
        requiredDifficulty: reducedDifficulty,
        fields: [
          VerityField.ContentName("Hic cubus usoris mutabilis valde mutabilis est"),
          VerityField.Payload("primum hoc dico"),
        ]
      }
    );
    muc.setDate(1715704514);  // now you know when this test was written!

    // assume both local and remote have this version of the MUC
    await local.cubeStore.addCube(muc);
    await remote.cubeStore.addCube(muc);
    const mucKey: CubeKey = await muc.getKey();

    // just some sanity checks
    expect(await local.cubeStore.getNumberOfStoredCubes()).toBe(1);
    expect(await remote.cubeStore.getNumberOfStoredCubes()).toBe(1);

    // local subscribes to MUC
    const subPromise: Promise<CubeSubscription> = local.scheduler.subscribeCube(mucKey);

    // expect subscription to be fully registered on both ends
    await subPromise;
    expect(local.scheduler.cubeAlreadySubscribed(mucKey)).toBe(true);
    expect(remoteToLocal.cubeSubscriptions).toContain(keyVariants(mucKey).keyString);

    // remote updates MUC
    muc.getFirstField(FieldType.PAYLOAD).value =
      Buffer.from("deinde iliud dico", 'ascii');
    muc.setDate(1715704520);  // a bit later than the last version
    await muc.compile();
    let result = await remote.cubeStore.addCube(muc);
    expect(result).toBeInstanceOf(Cube);
    // just some sanity checks
    expect(await local.cubeStore.getNumberOfStoredCubes()).toBe(1);
    expect(await remote.cubeStore.getNumberOfStoredCubes()).toBe(1);

    // local receives update
    await new Promise(resolve => setTimeout(resolve, 500));  // give it some time
    expect(await local.cubeStore.getNumberOfStoredCubes()).toBe(1);
    expect(await remote.cubeStore.getNumberOfStoredCubes()).toBe(1);
    expect((await local.cubeStore.getCube(mucKey)).getFirstField(
      FieldType.PAYLOAD).valueString).toBe("deinde iliud dico");
  });


  it('can first request and then subscribe a MUC', async () => {
    // assert remote is connected to local -- we'll use the NetworkPeer object
    // for some checks later
    expect(remote.incomingPeers.length).toEqual(1);
    const remoteToLocal: NetworkPeerIf = remote.incomingPeers[0];
    expect(remoteToLocal).toBeInstanceOf(NetworkPeer);

    // remote creates a MUC
    const keyPair = sodium.crypto_sign_keypair();
    let muc: Cube = cciCube.MUC(
      Buffer.from(keyPair.publicKey), Buffer.from(keyPair.privateKey),
      {
        requiredDifficulty: reducedDifficulty,
        fields: [
          VerityField.ContentName("Hic cubus usoris mutabilis valde mutabilis est"),
          VerityField.Payload("primum hoc dico"),
        ]
      }
    );
    muc.setDate(1715704514);  // now you know when this test was written!
    await remote.cubeStore.addCube(muc);
    const mucKey: CubeKey = await muc.getKey();
    // just some sanity checks
    expect(await local.cubeStore.getNumberOfStoredCubes()).toBe(0);
    expect(await remote.cubeStore.getNumberOfStoredCubes()).toBe(1);

    // local initially requests MUC
    const mucInfo = await local.scheduler.requestCube(mucKey);

    // local receives first MUC version
    expect(await local.cubeStore.getNumberOfStoredCubes()).toBe(1);
    expect(await remote.cubeStore.getNumberOfStoredCubes()).toBe(1);
    expect((await local.cubeStore.getCube(mucKey)).getFirstField(
      FieldType.PAYLOAD).valueString).toBe("primum hoc dico");

    // local subscribes to MUC
    const subPromise: Promise<CubeSubscription> = local.scheduler.subscribeCube(mucKey);

    // expect subscription to be fully registered on both ends
    await subPromise;
    expect(local.scheduler.cubeAlreadySubscribed(mucKey)).toBe(true);
    expect(remoteToLocal.cubeSubscriptions).toContain(keyVariants(mucKey).keyString);

    // remote updates MUC
    muc.getFirstField(FieldType.PAYLOAD).value =
      Buffer.from("deinde iliud dico", 'ascii');
    muc.setDate(1715704520);  // a bit later than the last version
    await muc.compile();
    let result = await remote.cubeStore.addCube(muc);
    expect(result).toBeInstanceOf(Cube);
    // just some sanity checks
    expect(await local.cubeStore.getNumberOfStoredCubes()).toBe(1);
    expect(await remote.cubeStore.getNumberOfStoredCubes()).toBe(1);

    // local receives update
    await new Promise(resolve => setTimeout(resolve, 500));  // give it some time
    expect(await local.cubeStore.getNumberOfStoredCubes()).toBe(1);
    expect(await remote.cubeStore.getNumberOfStoredCubes()).toBe(1);
    expect((await local.cubeStore.getCube(mucKey)).getFirstField(
      FieldType.PAYLOAD).valueString).toBe("deinde iliud dico");
  });


  it('can directly subscribe a MUC even if it has no local copy', async () => {
    // assert remote is connected to local -- we'll use the NetworkPeer object
    // for some checks later
    expect(remote.incomingPeers.length).toEqual(1);
    const remoteToLocal: NetworkPeerIf = remote.incomingPeers[0];
    expect(remoteToLocal).toBeInstanceOf(NetworkPeer);

    // remote creates a MUC
    const keyPair = sodium.crypto_sign_keypair();
    let muc: Cube = cciCube.MUC(
      Buffer.from(keyPair.publicKey), Buffer.from(keyPair.privateKey),
      {
        requiredDifficulty: reducedDifficulty,
        fields: [
          VerityField.ContentName("Hic cubus usoris mutabilis valde mutabilis est"),
          VerityField.Payload("primum hoc dico"),
        ]
      }
    );
    muc.setDate(1715704514);  // now you know when this test was written!
    await remote.cubeStore.addCube(muc);
    const mucKey: CubeKey = await muc.getKey();
    // just some sanity checks
    expect(await local.cubeStore.getNumberOfStoredCubes()).toBe(0);
    expect(await remote.cubeStore.getNumberOfStoredCubes()).toBe(1);

    // prepare promise: local shall later receive the first MUC version
    const localReceivesFirstMucVersion: Promise<CubeInfo> =
      local.cubeStore.expectCube(mucKey);

    // local subscribes to MUC
    const subPromise: Promise<CubeSubscription> = local.scheduler.subscribeCube(mucKey);

    // local receives first MUC version
    await localReceivesFirstMucVersion;
    expect(await local.cubeStore.getNumberOfStoredCubes()).toBe(1);
    expect(await remote.cubeStore.getNumberOfStoredCubes()).toBe(1);
    expect((await local.cubeStore.getCube(mucKey)).getFirstField(
      FieldType.PAYLOAD).valueString).toBe("primum hoc dico");

    // expect subscription to be fully registered on both ends
    await subPromise;
    expect(local.scheduler.cubeAlreadySubscribed(mucKey)).toBe(true);
    expect(remoteToLocal.cubeSubscriptions).toContain(keyVariants(mucKey).keyString);

    // remote updates MUC
    muc.getFirstField(FieldType.PAYLOAD).value =
      Buffer.from("deinde iliud dico", 'ascii');
    muc.setDate(1715704520);  // a bit later than the last version
    await muc.compile();
    let result = await remote.cubeStore.addCube(muc);
    expect(result).toBeInstanceOf(Cube);
    // just some sanity checks
    expect(await local.cubeStore.getNumberOfStoredCubes()).toBe(1);
    expect(await remote.cubeStore.getNumberOfStoredCubes()).toBe(1);

    // local receives update
    await new Promise(resolve => setTimeout(resolve, 500));  // give it some time
    expect(await local.cubeStore.getNumberOfStoredCubes()).toBe(1);
    expect(await remote.cubeStore.getNumberOfStoredCubes()).toBe(1);
    expect((await local.cubeStore.getCube(mucKey)).getFirstField(
      FieldType.PAYLOAD).valueString).toBe("deinde iliud dico");
  });
});
