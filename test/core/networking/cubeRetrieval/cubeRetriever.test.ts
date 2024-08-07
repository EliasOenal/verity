import { Cube } from "../../../../src/core/cube/cube";
import { CubeKey, CubeType } from "../../../../src/core/cube/cube.definitions";
import { CubeField } from "../../../../src/core/cube/cubeField";
import { CubeInfo } from "../../../../src/core/cube/cubeInfo";
import { CubeStore, CubeStoreOptions, EnableCubePersitence } from "../../../../src/core/cube/cubeStore";
import { CubeRetriever } from "../../../../src/core/networking/cubeRetrieval/cubeRetriever";
import { SupportedTransports } from "../../../../src/core/networking/networkDefinitions";
import { NetworkManager, NetworkManagerOptions } from "../../../../src/core/networking/networkManager";
import { NetworkPeer } from "../../../../src/core/networking/networkPeer";
import { WebSocketAddress } from "../../../../src/core/peering/addressing";
import { Peer } from "../../../../src/core/peering/peer";
import { PeerDB } from "../../../../src/core/peering/peerDB";

let local: NetworkManager;
let remote: NetworkManager;
let cubeRetriever: CubeRetriever;

const reducedDifficulty = 0;

const testCubeStoreParams: CubeStoreOptions = {
  enableCubePersistence: EnableCubePersitence.OFF,
  enableCubeRetentionPolicy: false,
  requiredDifficulty: 0,
};
const lightNodeMinimalFeatures: NetworkManagerOptions = {  // disable optional features
  announceToTorrentTrackers: false,
  autoConnect: false,
  lightNode: true,
  peerExchange: false,
};

describe('CubeRetriever', () => {
  beforeEach(async () => {
    local = new NetworkManager(
      new CubeStore(testCubeStoreParams),
      new PeerDB(),
      new Map([[SupportedTransports.ws, 18001]]),
      lightNodeMinimalFeatures,
    );
    cubeRetriever = new CubeRetriever(local.cubeStore, local.scheduler);
    remote = new NetworkManager(
      new CubeStore(testCubeStoreParams),
      new PeerDB(),
      new Map([[SupportedTransports.ws, 18002]]),
      lightNodeMinimalFeatures,
    );
    await Promise.all([local.start(), remote.start()]);
    const np: NetworkPeer =
      local.connect(new Peer(new WebSocketAddress("localhost", 18002)));
    await np.onlinePromise;
  });

  afterEach(async () => {
    await Promise.all([local.shutdown(), remote.shutdown()]);
  })


  it('retrieves a locally available Cube', async () => {
    // create Cube
    const cube: Cube = Cube.Frozen({
      fields: CubeField.RawContent(CubeType.FROZEN, "Cubus localis in loco nostro disponibilis est"),
      requiredDifficulty: reducedDifficulty,
    });
    await local.cubeStore.addCube(cube);
    const key: CubeKey = await cube.getKey();

    // retrieve Cube
    const retrieved: Cube = await cubeRetriever.getCube(key);
    expect((await retrieved.getHash()).equals(key)).toBe(true);
    // retrieve CubeInfo
    const retrievedInfo: CubeInfo = await cubeRetriever.getCubeInfo(key);
    expect(retrievedInfo.date).toEqual(cube.getDate());
    expect(retrievedInfo.binaryCube.equals(await cube.getBinaryData())).toBe(true);

    // just some sanity checks to ensure this test actually tests what it's supposed to
    expect(await local.cubeStore.getNumberOfStoredCubes()).toBe(1);
    expect(await remote.cubeStore.getNumberOfStoredCubes()).toBe(0);
  });

  it('retrieves a Cube available remotely', async () => {
      // create Cube
    const cube: Cube = Cube.Frozen({
      fields: CubeField.RawContent(CubeType.FROZEN, "Cubus remotus per rete petendus est"),
      requiredDifficulty: reducedDifficulty,
    });
    await remote.cubeStore.addCube(cube);
    const key: CubeKey = await cube.getKey();
    expect(await local.cubeStore.getNumberOfStoredCubes()).toBe(0);
    expect(await remote.cubeStore.getNumberOfStoredCubes()).toBe(1);

    // retrieve Cube
    const retrieved: Cube = await cubeRetriever.getCube(key);
    expect((await retrieved.getHash()).equals(key)).toBe(true);
    // retrieve CubeInfo
    const retrievedInfo: CubeInfo = await cubeRetriever.getCubeInfo(key);
    expect(retrievedInfo.date).toEqual(cube.getDate());
    expect(retrievedInfo.binaryCube.equals(await cube.getBinaryData())).toBe(true);

    // just some sanity checks to ensure this test actually tests what it's supposed to
    expect(await local.cubeStore.getNumberOfStoredCubes()).toBe(1);
    expect(await remote.cubeStore.getNumberOfStoredCubes()).toBe(1);
  });
});