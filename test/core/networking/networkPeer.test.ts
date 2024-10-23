import { KeyPair } from "../../../src/cci/helpers/cryptography";
import { Cube } from "../../../src/core/cube/cube";
import { CubeKey, CubeType } from "../../../src/core/cube/cube.definitions";
import { CubeField } from "../../../src/core/cube/cubeField";
import { CubeStore } from "../../../src/core/cube/cubeStore";
import { calculateHash, keyVariants } from "../../../src/core/cube/cubeUtil";
import { NetConstants } from "../../../src/core/networking/networkDefinitions";
import { NetworkManagerIf } from "../../../src/core/networking/networkManagerIf";
import { SubscribeCubeMessage, SubscriptionConfirmationMessage, SubscriptionResponseCode } from "../../../src/core/networking/networkMessage";
import { NetworkPeer } from "../../../src/core/networking/networkPeer";
import { DummyTransportConnection } from "../../../src/core/networking/testingDummies/DummyTransportConnection";
import { DummyNetworkManager } from "../../../src/core/networking/testingDummies/networkManagerDummy";
import { PeerDB } from "../../../src/core/peering/peerDB";
import { Settings } from "../../../src/core/settings";
import { requiredDifficulty, testCoreOptions } from "../testcore.definition";

import sodium from 'libsodium-wrappers-sumo'

// TODO: write a proper, complete set of unit tests
// We did not write actual unit tests for NetworkPeer in the beginning as we
// didn't have/use a proper mocking framework. Instead, we relied on our tests
// in NetworkManager, which are almost end-to-end tests involving actual
// network communiation.

describe('NetworkPeer', () => {
  let peer: NetworkPeer;
  let networkManager: NetworkManagerIf;
  let cubeStore: CubeStore;
  let peerDB: PeerDB;
  let available: Cube;
  let availableKey: CubeKey;
  let availableHash: Buffer;
  let available2: Cube;
  let availableKey2: CubeKey;
  let availableHash2: Buffer;
  let conn: DummyTransportConnection;

  beforeAll(async () => {
    await sodium.ready;
    cubeStore = new CubeStore(testCoreOptions);
    await cubeStore.readyPromise;

    // create two available Cubes
    const keys = sodium.crypto_sign_keypair();
    const keyPair = {
      publicKey: Buffer.from(keys.publicKey),
      privateKey: Buffer.from(keys.privateKey),
    };
    available = Cube.Create({
      cubeType: CubeType.MUC,
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
      fields: CubeField.RawContent(CubeType.MUC,
        "Subscribere, ne ullos nuntios perdas!"),
      requiredDifficulty,
    });
    availableKey = await available.getKey();
    availableHash = await available.getHash();
    await cubeStore.addCube(available);

    const keys2 = sodium.crypto_sign_keypair();
    const keyPair2 = {
      publicKey: Buffer.from(keys2.publicKey),
      privateKey: Buffer.from(keys2.privateKey),
    };
    available2 = Cube.Create({
      cubeType: CubeType.MUC,
      publicKey: keyPair2.publicKey,
      privateKey: keyPair2.privateKey,
      fields: CubeField.RawContent(CubeType.MUC,
        "Dic omnibus amicis tuis ut subscribant!"),
      requiredDifficulty,
    });
    availableKey2 = await available2.getKey();
    availableHash2 = await available2.getHash();
    await cubeStore.addCube(available2);
  });

  beforeEach(() => {
    peerDB = new PeerDB();
    networkManager = new DummyNetworkManager(cubeStore, peerDB);
    peer = new NetworkPeer(
      networkManager, new DummyTransportConnection(), cubeStore);
    conn = peer.conn as DummyTransportConnection;
  });


  describe('handleSubscribeCube() private method', () => {
    describe('single key subscription requests', () => {
      describe('accepted requests', () => {
        it('should confirm the subscription if the key is available', async () => {
          const req = new SubscribeCubeMessage([availableKey]);
          await (peer as any).handleSubscribeCube(req);

          expect(conn.sentMessages).toHaveLength(1);
          const binaryResponse = conn.sentMessages[0].subarray(2);
          const response = new SubscriptionConfirmationMessage(binaryResponse);
          expect(response.responseCode).toBe(SubscriptionResponseCode.SubscriptionConfirmed);
          expect(response.requestedKeyBlob).toEqual(availableKey);
          expect(response.cubesHashBlob).toEqual(availableHash);
          expect(response.subscriptionDuration).toBe(Settings.CUBE_SUBSCRIPTION_PERIOD);
        });

        it('should register the subscription if the key is available', async () => {
          const req = new SubscribeCubeMessage([availableKey]);
          await (peer as any).handleSubscribeCube(req);
          expect(peer.cubeSubscriptions).toHaveLength(1);
          expect(peer.cubeSubscriptions).toContain(keyVariants(availableKey).keyString);
        });
      });  // successful requests

      describe('denied requests', () => {
        it('should deny the subscription if the key is not available', async () => {
          const req = new SubscribeCubeMessage([
            Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x42),
          ]);
          await (peer as any).handleSubscribeCube(req);

          expect(conn.sentMessages).toHaveLength(1);
          const binaryResponse = conn.sentMessages[0].subarray(2);
          const response = new SubscriptionConfirmationMessage(binaryResponse);
          expect(response.responseCode).toBe(SubscriptionResponseCode.RequestedKeyNotAvailable);
          expect(response.requestedKeyBlob).toEqual(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x42));
          expect(response.cubesHashBlob).toBeUndefined();
          expect(response.subscriptionDuration).toBeUndefined();
        });

        it('should not register the subscription if the key is not available', async () => {
          const req = new SubscribeCubeMessage([
            Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x42),
          ]);
          await (peer as any).handleSubscribeCube(req);
          expect(peer.cubeSubscriptions).toHaveLength(0);
        });
      });  // denied requests

      describe('edge cases', () => {
        it.todo('renew the subscription period if requested key is already subscribed');
      });
    });

    describe('multiple key subscription requests', () => {
      describe('accepted requests', () => {
        it('should confirm the subscription if all keys are available', async () => {
          const req = new SubscribeCubeMessage([availableKey, availableKey2]);
          await (peer as any).handleSubscribeCube(req);

          expect(conn.sentMessages).toHaveLength(1);
          const binaryResponse = conn.sentMessages[0].subarray(2);
          const response = new SubscriptionConfirmationMessage(binaryResponse);
          expect(response.responseCode).toBe(SubscriptionResponseCode.SubscriptionConfirmed);

          const expectedKeyBlob: Buffer = calculateHash(
            Buffer.concat([availableKey, availableKey2]));
          expect(response.requestedKeyBlob).toEqual(expectedKeyBlob);

          const expectedHashBlob: Buffer = calculateHash(
            Buffer.concat([availableHash, availableHash2]));
          expect(response.cubesHashBlob).toEqual(expectedHashBlob);
          expect(response.subscriptionDuration).toBe(Settings.CUBE_SUBSCRIPTION_PERIOD);
        });

        it('should register the subscription if all keys are available', async () => {
          const req = new SubscribeCubeMessage([availableKey, availableKey2]);
          await (peer as any).handleSubscribeCube(req);
          expect(peer.cubeSubscriptions).toHaveLength(2);
          expect(peer.cubeSubscriptions).toContain(keyVariants(availableKey).keyString);
          expect(peer.cubeSubscriptions).toContain(keyVariants(availableKey2).keyString);
        });
      });

      describe('denied requests', () => {
        it('should deny the subscription if any key is not available', async () => {
          const req = new SubscribeCubeMessage([
            availableKey,
            Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x42),
          ]);
          await (peer as any).handleSubscribeCube(req);

          expect(conn.sentMessages).toHaveLength(1);
          const binaryResponse = conn.sentMessages[0].subarray(2);
          const response = new SubscriptionConfirmationMessage(binaryResponse);
          expect(response.responseCode).toBe(SubscriptionResponseCode.RequestedKeyNotAvailable);
          expect(response.requestedKeyBlob).toEqual(calculateHash(Buffer.concat([
            availableKey,
            Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x42)
          ])));
          expect(response.cubesHashBlob).toBeUndefined();
          expect(response.subscriptionDuration).toBeUndefined();
        });

        it('should not register any subscription if any key is not available', async () => {
          const req = new SubscribeCubeMessage([
            Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x42),
            availableKey,
          ]);
          await (peer as any).handleSubscribeCube(req);
          expect(peer.cubeSubscriptions).toHaveLength(0);
        });
      });

      describe('edge cases', () => {
        it.todo('should handle duplicate keys gracefully');
        it.todo('renew the subscription period if one of the requested key is already subscribed');
      });
    });
  });
});
