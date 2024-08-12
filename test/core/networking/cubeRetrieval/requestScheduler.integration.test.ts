import { cciFamily, cciCube } from "../../../../src/cci/cube/cciCube";
import { cciFieldType } from "../../../../src/cci/cube/cciCube.definitions";
import { cciField } from "../../../../src/cci/cube/cciField";
import { CubeKey } from "../../../../src/core/cube/cube.definitions";
import { CubeStoreOptions, EnableCubePersitence, CubeStore } from "../../../../src/core/cube/cubeStore";
import { SupportedTransports } from "../../../../src/core/networking/networkDefinitions";
import { NetworkManagerOptions, NetworkManager } from "../../../../src/core/networking/networkManager";
import { NetworkPeer } from "../../../../src/core/networking/networkPeer";
import { WebSocketAddress } from "../../../../src/core/peering/addressing";
import { Peer } from "../../../../src/core/peering/peer";
import { PeerDB } from "../../../../src/core/peering/peerDB";

import sodium from 'libsodium-wrappers-sumo'

const reducedDifficulty = 0; // no hash cash for testing

describe('RequestScheduler integration tests', () => {
  const testCubeStoreParams: CubeStoreOptions = {
    enableCubePersistence: EnableCubePersitence.OFF,
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
    requestTimeout: 100,
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
        ...testNetworkingOptions,
        transports: new Map([[SupportedTransports.ws, 18201]]),
      },
    );
    remote = new NetworkManager(
      new CubeStore(testCubeStoreParams),
      new PeerDB(),
      {
        ...testNetworkingOptions,
        transports: new Map([[SupportedTransports.ws, 18202]]),
      },
    );
    await Promise.all([local.start(), remote.start()]);
    const np: NetworkPeer =
      local.connect(new Peer(new WebSocketAddress("localhost", 18202)));
    await np.onlinePromise;
  });

  afterEach(async() => {
    await Promise.all([local.shutdown(), remote.shutdown()]);
  });

  it('should correctly fetch updates to subscribed MUCs', async () => {
    // remote creates a MUC
    const keyPair = sodium.crypto_sign_keypair();
    const muc: cciCube = cciCube.MUC(
      Buffer.from(keyPair.publicKey), Buffer.from(keyPair.privateKey),
      {
        requiredDifficulty: reducedDifficulty,
        fields: [
          cciField.ContentName("Hic cubus usoris mutabilis valde mutabilis est"),
          cciField.Payload("primum hoc dico"),
        ]
      }
    );
    muc.setDate(1715704514);  // now you know when this test was written!
    await remote.cubeStore.addCube(muc);
    const mucKey: CubeKey = await muc.getKey();
    // just some sanity checks
    expect(await local.cubeStore.getNumberOfStoredCubes()).toBe(0);
    expect(await remote.cubeStore.getNumberOfStoredCubes()).toBe(1);
    // local subscribes to MUC
    local.scheduler.subscribeCube(mucKey);
    // local receives first MUC version
    await new Promise(resolve => setTimeout(resolve, 100));  // give it some time
    expect(await local.cubeStore.getNumberOfStoredCubes()).toBe(1);
    expect(await remote.cubeStore.getNumberOfStoredCubes()).toBe(1);
    expect((await local.cubeStore.getCube(mucKey)).fields.getFirst(
      cciFieldType.PAYLOAD).valueString).toBe("primum hoc dico");
    // remote updates MUC
    muc.fields.getFirst(cciFieldType.PAYLOAD).value =
      Buffer.from("deinde iliud dico", 'ascii');
    muc.setDate(1715704520);  // a bit later then the last version
    await muc.compile();
    await remote.cubeStore.addCube(muc);
    // just some sanity checks
    expect(await local.cubeStore.getNumberOfStoredCubes()).toBe(1);
    expect(await remote.cubeStore.getNumberOfStoredCubes()).toBe(1);
    // local receives update
    await new Promise(resolve => setTimeout(resolve, 100));  // give it some time
    expect(await local.cubeStore.getNumberOfStoredCubes()).toBe(1);
    expect(await remote.cubeStore.getNumberOfStoredCubes()).toBe(1);
    expect((await local.cubeStore.getCube(mucKey)).fields.getFirst(
      cciFieldType.PAYLOAD).valueString).toBe("deinde iliud dico");
  });
});
