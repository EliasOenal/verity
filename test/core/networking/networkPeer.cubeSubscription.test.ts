import { KeyPair } from "../../../src/cci/helpers/cryptography";
import { Cube } from "../../../src/core/cube/cube";
import { CubeKey, CubeType } from "../../../src/core/cube/cube.definitions";
import { CubeField } from "../../../src/core/cube/cubeField";
import { CubeStore } from "../../../src/core/cube/cubeStore";
import { calculateHash } from "../../../src/core/cube/cubeUtil";
import { keyVariants } from "../../../src/core/cube/keyUtil";
import { unixtime } from "../../../src/core/helpers/misc";
import { MessageClass, NetConstants } from "../../../src/core/networking/networkDefinitions";
import { NetworkManagerIf } from "../../../src/core/networking/networkManagerIf";
import { CubeResponseMessage, NetworkMessage, SubscribeCubeMessage, SubscriptionConfirmationMessage, SubscriptionResponseCode } from "../../../src/core/networking/networkMessage";
import { NetworkPeer } from "../../../src/core/networking/networkPeer";
import { DummyTransportConnection } from "../../../src/core/networking/testingDummies/dummyTransportConnection";
import { DummyNetworkManager } from "../../../src/core/networking/testingDummies/dummyNetworkManager";
import { PeerDB } from "../../../src/core/peering/peerDB";
import { Settings } from "../../../src/core/settings";
import { requiredDifficulty, testCoreOptions } from "../testcore.definition";

import sodium from 'libsodium-wrappers-sumo'
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

const TEST_SUBSCRIPTION_PERIOD = 1000;  // TODO BUGBUG this does not seem to work for shorter periods e.g. 500, why?!?!?!

describe('NetworkPeer CubeSubscription tests', () => {
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
  let keyPair: KeyPair;
  let keyPair2: KeyPair;

  beforeAll(async () => {
    await sodium.ready;
    cubeStore = new CubeStore(testCoreOptions);
    await cubeStore.readyPromise;

    // create two available Cubes
    const keys = sodium.crypto_sign_keypair();
    keyPair = {
      publicKey: Buffer.from(keys.publicKey),
      privateKey: Buffer.from(keys.privateKey),
    };
    available = Cube.Create({
      cubeType: CubeType.MUC,
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
      fields: [
        CubeField.RawContent(CubeType.MUC,
          "Subscribere, ne ullos nuntios perdas!"),
        CubeField.Date(unixtime() - 10000),
      ],
      requiredDifficulty,
    });
    availableKey = await available.getKey();
    availableHash = await available.getHash();
    await cubeStore.addCube(available);

    const keys2 = sodium.crypto_sign_keypair();
    keyPair2 = {
      publicKey: Buffer.from(keys2.publicKey),
      privateKey: Buffer.from(keys2.privateKey),
    };
    available2 = Cube.Create({
      cubeType: CubeType.MUC,
      publicKey: keyPair2.publicKey,
      privateKey: keyPair2.privateKey,
      fields: [
        CubeField.RawContent(CubeType.MUC,
          "Dic omnibus amicis tuis ut subscribant!"),
        CubeField.Date(unixtime() - 10000),
      ],
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
      networkManager, new DummyTransportConnection(), cubeStore,
      {
        cubeSubscriptionPeriod: TEST_SUBSCRIPTION_PERIOD,
      }
    );
    conn = peer.conn as DummyTransportConnection;
  });


  describe('establishing subscriptions / handleSubscribeCube() private method', () => {
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
          expect(response.subscriptionDuration).toBe(TEST_SUBSCRIPTION_PERIOD);
        });

        it('should register the subscription if the key is available', async () => {
          const req = new SubscribeCubeMessage([availableKey]);
          await (peer as any).handleSubscribeCube(req);
          expect(peer.cubeSubscriptions).toHaveLength(1);
          expect(peer.cubeSubscriptions).toContain(keyVariants(availableKey).keyString);
        });

        it('should remove the subscription once it has expired', async () => {
          // make subscription
          const req = new SubscribeCubeMessage([availableKey]);
          await (peer as any).handleSubscribeCube(req);
          expect(peer.cubeSubscriptions).toHaveLength(1);
          expect(peer.cubeSubscriptions).toContain(keyVariants(availableKey).keyString);

          // wait for expiry
          await new Promise(resolve => setTimeout(resolve, TEST_SUBSCRIPTION_PERIOD + 10));

          // subscription should be removed
          expect(peer.cubeSubscriptions).toHaveLength(0);
        });
      });  // successful requests

      describe('denied requests', () => {
        it('should deny the subscription if the key is not available', async () => {
          const req = new SubscribeCubeMessage([
            Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x42) as CubeKey,
          ]);
          await (peer as any).handleSubscribeCube(req);

          expect(conn.sentMessages).toHaveLength(1);
          const binaryResponse = conn.sentMessages[0].subarray(2);
          const response = new SubscriptionConfirmationMessage(binaryResponse);
          expect(response.responseCode).toBe(SubscriptionResponseCode.RequestedKeyNotAvailable);
          expect(response.requestedKeyBlob).toEqual(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x42));
          expect(response.cubesHashBlob.length).toBe(0);
          expect(response.subscriptionDuration).toBe(0);
        });

        it('should not register the subscription if the key is not available', async () => {
          const req = new SubscribeCubeMessage([
            Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x42) as CubeKey,
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
          expect(response.subscriptionDuration).toBe(TEST_SUBSCRIPTION_PERIOD);
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
            Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x42) as CubeKey,
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
          expect(response.cubesHashBlob.length).toBe(0);
          expect(response.subscriptionDuration).toBe(0);
        });

        it('should not register any subscription if any key is not available', async () => {
          const req = new SubscribeCubeMessage([
            Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x42) as CubeKey,
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
  });  // handleSubscribeCube() private method

  describe('serving subscribers', () => {
    describe('sendSubscribedCubeUpdate() private method', () => {
      it('should send a CubeUpdateMessage when a subscribed Cube is updated', async () => {
        // make subscription
        const req = new SubscribeCubeMessage([availableKey]);
        await (peer as any).handleSubscribeCube(req);

        // update Cube
        available = Cube.Create({
          cubeType: CubeType.MUC,
          publicKey: keyPair.publicKey,
          privateKey: keyPair.privateKey,
          fields: [
            CubeField.RawContent(CubeType.MUC,
              "Ne obliviscaris campanulam pulsare!"),
            CubeField.Date(unixtime() - 9000),  // newer than last version
          ],
          requiredDifficulty,
        });
        availableKey = await available.getKey();
        availableHash = await available.getHash();
        await cubeStore.addCube(available);

        // expect a CubeUpdateMessage to have been "sent" through our dummy connection:
        // fetch latest message
        const binaryMessage: Buffer =
          conn.sentMessages[conn.sentMessages.length-1]
          .subarray(NetConstants.PROTOCOL_VERSION_SIZE);
        // decompile message
        const msg: CubeResponseMessage = NetworkMessage.fromBinary(binaryMessage) as CubeResponseMessage;
        expect(msg.type).toBe(MessageClass.CubeResponse);
        expect(msg.cubeCount).toBe(1);
        // retrieve binary Cube from message
        const binaryCube: Buffer = Array.from(msg.binaryCubes())[0];
        // should be the updated Cube binary
        expect(binaryCube.equals(available.getBinaryDataIfAvailable())).toBeTruthy();
      });
    });
  });

  describe.todo('timing out subscriptions');
});
