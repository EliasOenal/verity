import { CubeKey, CubeType, NotificationKey } from "../../../src/core/cube/cube.definitions";
import { Cube } from "../../../src/core/cube/cube";
import { CubeInfo } from "../../../src/core/cube/cubeInfo";
import { MessageClass, NetConstants, NodeType } from "../../../src/core/networking/networkDefinitions";
import { NetworkMessage, HelloMessage, KeyRequestMessage, KeyResponseMessage, CubeRequestMessage, CubeResponseMessage, ServerAddressMessage, PeerRequestMessage, PeerResponseMessage, KeyRequestMode, SubscriptionResponseCode, SubscriptionConfirmationMessage } from "../../../src/core/networking/networkMessage";
import { AddressAbstraction } from "../../../src/core/peering/addressing";
import { Peer } from "../../../src/core/peering/peer";
import { VerityError } from "../../../src/core/settings";
import { CubeField } from "../../../src/core/cube/cubeField";
import { calculateHash } from "../../../src/core/cube/cubeUtil";

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('NetworkMessage', () => {
  describe('fromBinary() static method', () => {
    it('should create a valid Hello message', () => {
      const helloMessage = NetworkMessage.fromBinary(Buffer.concat([
        Buffer.alloc(NetConstants.MESSAGE_CLASS_SIZE, MessageClass.Hello),
        Buffer.from('abcdefghijklmnop', 'ascii'),
      ]));
      expect(helloMessage).toBeInstanceOf(HelloMessage);
    });

    it('should create a valid KeyRequest message', () => {
      const keyRequestMessage = NetworkMessage.fromBinary(Buffer.concat([
        Buffer.alloc(1, MessageClass.KeyRequest),
        Buffer.alloc(NetConstants.KEY_REQUEST_MODE_SIZE, KeyRequestMode.SlidingWindow),
        Buffer.alloc(NetConstants.KEY_COUNT_SIZE, 42),
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 1337),
      ]));
      expect(keyRequestMessage).toBeInstanceOf(KeyRequestMessage);

      // Add similar tests for other message types
    });

    it.todo('should create a valid KeyResponse message');
    it.todo('should create a valid CubeRequest message');
    it.todo('should create a valid CubeResponse message');
    it.todo('should create a valid MyServerAddress message');
    it.todo('should create a valid PeerRequest message');
    it.todo('should create a valid PeerResponse message');

    it('should throw VerityError for unknown message type', () => {
      expect(() => NetworkMessage.fromBinary(Buffer.concat([
        Buffer.alloc(1, 255),
        Buffer.from('InvalidType'),
      ]))).toThrow(VerityError);
    });
  });
});

describe('HelloMessage', () => {
  it('should have remoteId property', () => {
    const buffer = Buffer.from('abcdefghijklmnop', 'ascii');
    const helloMessage = new HelloMessage(buffer);
    expect(helloMessage.type).toEqual(MessageClass.Hello);
    expect(helloMessage.remoteId).toEqual(buffer);
  });

  describe('node type functionality', () => {
    it('should create HelloMessage with full node type', () => {
      const peerId = Buffer.from('abcdefghijklmnop', 'ascii');
      const helloMessage = new HelloMessage(peerId, NodeType.Full);
      
      expect(helloMessage.type).toEqual(MessageClass.Hello);
      expect(helloMessage.remoteId).toEqual(peerId);
      expect(helloMessage.nodeType).toEqual(NodeType.Full);
      expect(helloMessage.value.length).toEqual(NetConstants.PEER_ID_SIZE + NetConstants.NODE_TYPE_SIZE);
    });

    it('should create HelloMessage with light node type', () => {
      const peerId = Buffer.from('abcdefghijklmnop', 'ascii');
      const helloMessage = new HelloMessage(peerId, NodeType.Light);
      
      expect(helloMessage.type).toEqual(MessageClass.Hello);
      expect(helloMessage.remoteId).toEqual(peerId);
      expect(helloMessage.nodeType).toEqual(NodeType.Light);
      expect(helloMessage.value.length).toEqual(NetConstants.PEER_ID_SIZE + NetConstants.NODE_TYPE_SIZE);
    });

    it('should parse HelloMessage with node type from binary data', () => {
      const peerId = Buffer.from('abcdefghijklmnop', 'ascii');
      const buffer = Buffer.alloc(NetConstants.PEER_ID_SIZE + NetConstants.NODE_TYPE_SIZE);
      peerId.copy(buffer, 0);
      buffer.writeUInt8(NodeType.Full, NetConstants.PEER_ID_SIZE);
      
      const helloMessage = new HelloMessage(buffer);
      expect(helloMessage.remoteId).toEqual(peerId);
      expect(helloMessage.nodeType).toEqual(NodeType.Full);
    });

    it('should return undefined nodeType for messages without node type field', () => {
      const buffer = Buffer.from('abcdefghijklmnop', 'ascii'); // Only 16 bytes (peer ID)
      const helloMessage = new HelloMessage(buffer);
      
      expect(helloMessage.remoteId).toEqual(buffer);
      expect(helloMessage.nodeType).toBeUndefined();
    });

    it('should return undefined nodeType for invalid node type values', () => {
      const peerId = Buffer.from('abcdefghijklmnop', 'ascii');
      const buffer = Buffer.alloc(NetConstants.PEER_ID_SIZE + NetConstants.NODE_TYPE_SIZE);
      peerId.copy(buffer, 0);
      buffer.writeUInt8(0xFF, NetConstants.PEER_ID_SIZE); // Invalid node type
      
      const helloMessage = new HelloMessage(buffer);
      expect(helloMessage.remoteId).toEqual(peerId);
      expect(helloMessage.nodeType).toBeUndefined();
    });

    it('should work with NetworkMessage.fromBinary for node type messages', () => {
      const peerId = Buffer.from('abcdefghijklmnop', 'ascii');
      const messageBuffer = Buffer.alloc(NetConstants.MESSAGE_CLASS_SIZE + NetConstants.PEER_ID_SIZE + NetConstants.NODE_TYPE_SIZE);
      messageBuffer.writeUInt8(MessageClass.Hello, 0);
      peerId.copy(messageBuffer, NetConstants.MESSAGE_CLASS_SIZE);
      messageBuffer.writeUInt8(NodeType.Light, NetConstants.MESSAGE_CLASS_SIZE + NetConstants.PEER_ID_SIZE);
      
      const helloMessage = NetworkMessage.fromBinary(messageBuffer) as HelloMessage;
      expect(helloMessage).toBeInstanceOf(HelloMessage);
      expect(helloMessage.remoteId).toEqual(peerId);
      expect(helloMessage.nodeType).toEqual(NodeType.Light);
    });

    it('should maintain backward compatibility with old Hello messages', () => {
      const oldHelloMessage = NetworkMessage.fromBinary(Buffer.concat([
        Buffer.alloc(NetConstants.MESSAGE_CLASS_SIZE, MessageClass.Hello),
        Buffer.from('abcdefghijklmnop', 'ascii'),
      ])) as HelloMessage;
      
      expect(oldHelloMessage).toBeInstanceOf(HelloMessage);
      expect(oldHelloMessage.remoteId).toEqual(Buffer.from('abcdefghijklmnop', 'ascii'));
      expect(oldHelloMessage.nodeType).toBeUndefined();
    });
  });
});

describe('KeyRequestMessage', () => {
  describe('compilation', () => {
    it('should create a valid KeyRequestMessage in SlidingWindow mode', () => {
      const keyRequestMessage = new KeyRequestMessage(
        KeyRequestMode.SlidingWindow, {
          maxCount: 10,
          startKey: Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42) as CubeKey,
      });
      expect(keyRequestMessage.type).toEqual(MessageClass.KeyRequest);
      expect(keyRequestMessage.value).toBeInstanceOf(Buffer);
      // verify length
      expect(keyRequestMessage.value.length).toEqual(NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE + NetConstants.CUBE_KEY_SIZE);
      // verify mode
      expect(keyRequestMessage.value.readUIntBE(0, NetConstants.KEY_REQUEST_MODE_SIZE)).toEqual(KeyRequestMode.SlidingWindow);
      // verify key count
      expect(keyRequestMessage.value.readUIntBE(NetConstants.KEY_REQUEST_MODE_SIZE, NetConstants.KEY_COUNT_SIZE)).toEqual(10);
      // verify start key
      expect(keyRequestMessage.value.subarray(
        NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE,  // start index
        NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE + NetConstants.CUBE_KEY_SIZE  // end index
      )).toEqual(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42));
    });

    it('should create a valid KeyRequestMessage in Sequential Store Sync mode', () => {
      const keyRequestMessage = new KeyRequestMessage(
        KeyRequestMode.SequentialStoreSync, {
          maxCount: 5,
          startKey: Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 137) as CubeKey,
      });
      expect(keyRequestMessage.type).toEqual(MessageClass.KeyRequest);
      expect(keyRequestMessage.value).toBeInstanceOf(Buffer);
      // verify length
      expect(keyRequestMessage.value.length).toEqual(NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE + NetConstants.CUBE_KEY_SIZE);
      // verify mode
      expect(keyRequestMessage.value.readUIntBE(0, NetConstants.KEY_REQUEST_MODE_SIZE)).toEqual(KeyRequestMode.SequentialStoreSync);
      // verify key count
      expect(keyRequestMessage.value.readUIntBE(NetConstants.KEY_REQUEST_MODE_SIZE, NetConstants.KEY_COUNT_SIZE)).toEqual(5);
      // verify start key
      expect(keyRequestMessage.value.subarray(
        NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE,  // start index
        NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE + NetConstants.CUBE_KEY_SIZE  // end index
      )).toEqual(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 137));
    });

    it('should create a valid KeyRequestMessage in Notification w/ Challenge Constraint mode', () => {
      const keyRequestMessage = new KeyRequestMessage(
        KeyRequestMode.NotificationChallenge, {
          maxCount: 5,
          startKey: Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 137) as CubeKey,
          notifies: Buffer.alloc(NetConstants.NOTIFY_SIZE, 69) as NotificationKey,
          difficulty: 42,
        }
      );
      expect(keyRequestMessage.type).toEqual(MessageClass.KeyRequest);
      expect(keyRequestMessage.value).toBeInstanceOf(Buffer);
      // verify length
      expect(keyRequestMessage.value.length).toEqual(NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE + NetConstants.CUBE_KEY_SIZE + NetConstants.NOTIFY_SIZE + NetConstants.CHALLENGE_LEVEL_SIZE);
      // verify mode
      expect(keyRequestMessage.value.readUIntBE(0, NetConstants.KEY_REQUEST_MODE_SIZE)).toEqual(KeyRequestMode.NotificationChallenge);
      // verify key count
      expect(keyRequestMessage.value.readUIntBE(NetConstants.KEY_REQUEST_MODE_SIZE, NetConstants.KEY_COUNT_SIZE)).toEqual(5);
      // verify start key
      expect(keyRequestMessage.value.subarray(
        NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE,  // start index
        NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE + NetConstants.CUBE_KEY_SIZE  // end index
      )).toEqual(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 137));
      // verify notify
      expect(keyRequestMessage.value.subarray(
        NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE + NetConstants.CUBE_KEY_SIZE,  // start index
        NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE + NetConstants.CUBE_KEY_SIZE + NetConstants.NOTIFY_SIZE  // end index
      )).toEqual(Buffer.alloc(NetConstants.NOTIFY_SIZE, 69));
      // verify min difficulty
      expect(keyRequestMessage.value.readUIntBE(
        NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE + NetConstants.CUBE_KEY_SIZE + NetConstants.NOTIFY_SIZE,  // start index
        NetConstants.CHALLENGE_LEVEL_SIZE  // read length
      )).toEqual(42);
    });

    it('should create a valid KeyRequestMessage in Notification w/ Challenge Constraint mode w/ a default challenge of 0', () => {
      const keyRequestMessage = new KeyRequestMessage(
        KeyRequestMode.NotificationChallenge, {
          maxCount: 5,
          startKey: Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 137) as CubeKey,
          notifies: Buffer.alloc(NetConstants.NOTIFY_SIZE, 69) as NotificationKey,
        }
      );
      expect(keyRequestMessage.type).toEqual(MessageClass.KeyRequest);
      expect(keyRequestMessage.value).toBeInstanceOf(Buffer);
      // verify length
      expect(keyRequestMessage.value.length).toEqual(NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE + NetConstants.CUBE_KEY_SIZE + NetConstants.NOTIFY_SIZE + NetConstants.CHALLENGE_LEVEL_SIZE);
      // verify mode
      expect(keyRequestMessage.value.readUIntBE(0, NetConstants.KEY_REQUEST_MODE_SIZE)).toEqual(KeyRequestMode.NotificationChallenge);
      // verify key count
      expect(keyRequestMessage.value.readUIntBE(NetConstants.KEY_REQUEST_MODE_SIZE, NetConstants.KEY_COUNT_SIZE)).toEqual(5);
      // verify start key
      expect(keyRequestMessage.value.subarray(
        NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE,  // start index
        NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE + NetConstants.CUBE_KEY_SIZE  // end index
      )).toEqual(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 137));
      // verify notify
      expect(keyRequestMessage.value.subarray(
        NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE + NetConstants.CUBE_KEY_SIZE,  // start index
        NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE + NetConstants.CUBE_KEY_SIZE + NetConstants.NOTIFY_SIZE  // end index
      )).toEqual(Buffer.alloc(NetConstants.NOTIFY_SIZE, 69));
      // verify min difficulty
      expect(keyRequestMessage.value.readUIntBE(
        NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE + NetConstants.CUBE_KEY_SIZE + NetConstants.NOTIFY_SIZE,  // start index
        NetConstants.CHALLENGE_LEVEL_SIZE  // read length
      )).toEqual(0);
    });

    it('should create a valid KeyRequestMessage in Notification w/ Timestamp constraint mode', () => {
      const keyRequestMessage = new KeyRequestMessage(
        KeyRequestMode.NotificationTimestamp, {
          maxCount: 5,
          startKey: Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 137) as CubeKey,
          notifies: Buffer.alloc(NetConstants.NOTIFY_SIZE, 69) as NotificationKey,
          timeMin: 42,
          timeMax: 1337,
      });
      expect(keyRequestMessage.type).toEqual(MessageClass.KeyRequest);
      expect(keyRequestMessage.value).toBeInstanceOf(Buffer);
      // verify length
      expect(keyRequestMessage.value.length).toEqual(
        NetConstants.KEY_REQUEST_MODE_SIZE +
        NetConstants.KEY_COUNT_SIZE +
        NetConstants.CUBE_KEY_SIZE +
        NetConstants.NOTIFY_SIZE +
        2*NetConstants.TIMESTAMP_SIZE
      );
      // verify mode
      expect(keyRequestMessage.value.readUIntBE(0, NetConstants.KEY_REQUEST_MODE_SIZE)).toEqual(KeyRequestMode.NotificationTimestamp);
      // verify key count
      expect(keyRequestMessage.value.readUIntBE(NetConstants.KEY_REQUEST_MODE_SIZE, NetConstants.KEY_COUNT_SIZE)).toEqual(5);
      // verify start key
      expect(keyRequestMessage.value.subarray(
        NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE,  // start index
        NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE + NetConstants.CUBE_KEY_SIZE  // end index
      )).toEqual(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 137));
      // verify notify
      expect(keyRequestMessage.value.subarray(
        NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE + NetConstants.CUBE_KEY_SIZE,  // start index
        NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE + NetConstants.CUBE_KEY_SIZE + NetConstants.NOTIFY_SIZE  // end index
      )).toEqual(Buffer.alloc(NetConstants.NOTIFY_SIZE, 69));
      // verify timestamps
      expect(keyRequestMessage.value.readUIntBE(
        NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE + NetConstants.CUBE_KEY_SIZE + NetConstants.NOTIFY_SIZE,  // start index
        NetConstants.TIMESTAMP_SIZE  // read length
      )).toEqual(42);
      expect(keyRequestMessage.value.readUIntBE(
        NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE + NetConstants.CUBE_KEY_SIZE + NetConstants.NOTIFY_SIZE + NetConstants.TIMESTAMP_SIZE,  // start index
        NetConstants.TIMESTAMP_SIZE  // read length
      )).toEqual(1337);
    });

    it('should create a valid KeyRequestMessage in Notification w/ Timestamp constraint mode with default timestamps', () => {
      const keyRequestMessage = new KeyRequestMessage(
        KeyRequestMode.NotificationTimestamp, {
          maxCount: 5,
          startKey: Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 137) as CubeKey,
          notifies: Buffer.alloc(NetConstants.NOTIFY_SIZE, 69) as NotificationKey,
      });
      expect(keyRequestMessage.type).toEqual(MessageClass.KeyRequest);
      expect(keyRequestMessage.value).toBeInstanceOf(Buffer);
      // verify length
      expect(keyRequestMessage.value.length).toEqual(
        NetConstants.KEY_REQUEST_MODE_SIZE +
        NetConstants.KEY_COUNT_SIZE +
        NetConstants.CUBE_KEY_SIZE +
        NetConstants.NOTIFY_SIZE +
        2*NetConstants.TIMESTAMP_SIZE
      );
      // verify mode
      expect(keyRequestMessage.value.readUIntBE(0, NetConstants.KEY_REQUEST_MODE_SIZE)).toEqual(KeyRequestMode.NotificationTimestamp);
      // verify key count
      expect(keyRequestMessage.value.readUIntBE(NetConstants.KEY_REQUEST_MODE_SIZE, NetConstants.KEY_COUNT_SIZE)).toEqual(5);
      // verify start key
      expect(keyRequestMessage.value.subarray(
        NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE,  // start index
        NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE + NetConstants.CUBE_KEY_SIZE  // end index
      )).toEqual(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 137));
      // verify notify
      expect(keyRequestMessage.value.subarray(
        NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE + NetConstants.CUBE_KEY_SIZE,  // start index
        NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE + NetConstants.CUBE_KEY_SIZE + NetConstants.NOTIFY_SIZE  // end index
      )).toEqual(Buffer.alloc(NetConstants.NOTIFY_SIZE, 69));
      // verify min timestamp
      expect(keyRequestMessage.value.subarray(
        NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE + NetConstants.CUBE_KEY_SIZE + NetConstants.NOTIFY_SIZE,  // start index
        NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE + NetConstants.CUBE_KEY_SIZE + NetConstants.NOTIFY_SIZE + NetConstants.TIMESTAMP_SIZE  // end index
      )).toEqual(Buffer.alloc(NetConstants.TIMESTAMP_SIZE, 0));
      // verify max timestamp
      expect(keyRequestMessage.value.subarray(
        NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE + NetConstants.CUBE_KEY_SIZE + NetConstants.NOTIFY_SIZE + NetConstants.TIMESTAMP_SIZE,  // start index
        NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE + NetConstants.CUBE_KEY_SIZE + NetConstants.NOTIFY_SIZE + 2*NetConstants.TIMESTAMP_SIZE  // end index
      )).toEqual(Buffer.alloc(NetConstants.TIMESTAMP_SIZE, 0xff));
    });
  });  // compilation

  describe('round trip', () => {
    it('should decompile a valid KeyRequestMessage in SlidingWindow mode', () => {
      const compiling = new KeyRequestMessage(KeyRequestMode.SlidingWindow, {
        maxCount: 5,
        startKey: Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 137) as CubeKey,
      });
      const msg = new KeyRequestMessage(compiling.value);

      expect(msg.type).toEqual(MessageClass.KeyRequest);
      expect(msg.value).toEqual(compiling.value);

      expect(msg.keyCount).toEqual(5);
      expect(msg.startKey).toEqual(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 137));
    });

    it('should decompile a valid KeyRequestMessage in Sequential Store Sync mode', () => {
      const compiling = new KeyRequestMessage(KeyRequestMode.SequentialStoreSync, {
        maxCount: 5,
        startKey: Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 137) as CubeKey,
      });
      const msg = new KeyRequestMessage(compiling.value);

      expect(msg.type).toEqual(MessageClass.KeyRequest);
      expect(msg.value).toEqual(compiling.value);

      expect(msg.keyCount).toEqual(5);
      expect(msg.startKey).toEqual(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 137));
    });

    it('should decompile a valid KeyRequestMessage in Notification w/ Challenge Constraint mode', () => {
      const compiling = new KeyRequestMessage(KeyRequestMode.NotificationChallenge, {
        maxCount: 5,
        startKey: Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 137) as CubeKey,
        notifies: Buffer.alloc(NetConstants.NOTIFY_SIZE, 69) as NotificationKey,
        difficulty: 42,
      });
      const msg = new KeyRequestMessage(compiling.value);

      expect(msg.type).toEqual(MessageClass.KeyRequest);
      expect(msg.value).toEqual(compiling.value);

      expect(msg.keyCount).toEqual(5);
      expect(msg.startKey).toEqual(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 137));
      expect(msg.notifies).toEqual(Buffer.alloc(NetConstants.NOTIFY_SIZE, 69));
      expect(msg.difficulty).toEqual(42);
    });

    it('should decompile a valid KeyRequestMessage in Notification w/ Timestamp Constraint mode', () => {
      const compiling = new KeyRequestMessage(KeyRequestMode.NotificationTimestamp, {
        maxCount: 5,
        startKey: Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 137) as CubeKey,
        notifies: Buffer.alloc(NetConstants.NOTIFY_SIZE, 69) as NotificationKey,
        timeMin: 42,
        timeMax: 31337,
      });
      const msg = new KeyRequestMessage(compiling.value);

      expect(msg.type).toEqual(MessageClass.KeyRequest);
      expect(msg.value).toEqual(compiling.value);

      expect(msg.keyCount).toEqual(5);
      expect(msg.startKey).toEqual(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 137));
      expect(msg.notifies).toEqual(Buffer.alloc(NetConstants.NOTIFY_SIZE, 69));
      expect(msg.timeMin).toEqual(42);
      expect(msg.timeMax).toEqual(31337);
    });
  });
});  // KeyRequestMessage

describe('KeyResponseMessage, CubeRequestMessage and CubeResponseMessage', () => {
  let cube1: Cube, cube2: Cube, cube3: Cube;
  let cubeInfo1: CubeInfo, cubeInfo2: CubeInfo, cubeInfo3: CubeInfo;

  beforeAll(async () => {
    // prepare some cube keys
    cube1 = Cube.Frozen({
      fields: CubeField.RawContent(CubeType.FROZEN, "Primus cubus transmittendus est"),
      requiredDifficulty: 0,
    });
    cube2 = Cube.Frozen({
      fields: CubeField.RawContent(CubeType.FROZEN, "Secundus cubus transmittendus est"),
      requiredDifficulty: 0,
    });
    cube3 = Cube.Frozen({
      fields: CubeField.RawContent(CubeType.FROZEN, "Tertius cubus transmittendus est"),
      requiredDifficulty: 0,
    });
    cubeInfo1 = await cube1.getCubeInfo();
    cubeInfo2 = await cube2.getCubeInfo();
    cubeInfo3 = await cube3.getCubeInfo();
  });

  it('should create and parse KeyResponseMessage', async() => {
    // create message
    const keyResponseMessage = new KeyResponseMessage(KeyRequestMode.SlidingWindow, [cubeInfo1, cubeInfo2, cubeInfo3]);

    // test construction based on CubeMeta list
    {
      expect(keyResponseMessage.type).toEqual(MessageClass.KeyResponse);
      expect(keyResponseMessage.value).toBeInstanceOf(Buffer);
      expect(keyResponseMessage.length).toBeGreaterThan(96);  // three keys payload + some metadata and overhead
      expect(keyResponseMessage.keyCount).toEqual(3);
      const recoveredInfos: CubeInfo[] = Array.from(keyResponseMessage.cubeInfos());
      expect(recoveredInfos.length).toEqual(3);
      expect(recoveredInfos[0].keyString).toEqual(cubeInfo1.keyString);
      expect(recoveredInfos[1].keyString).toEqual(cubeInfo2.keyString);
      expect(recoveredInfos[2].keyString).toEqual(cubeInfo3.keyString);
    }

    // test construction based on Buffer
    {
      const reconstructedMessage = new KeyResponseMessage(keyResponseMessage.value);
      expect(reconstructedMessage.type).toEqual(MessageClass.KeyResponse);
      expect(reconstructedMessage.value).toBeInstanceOf(Buffer);
      expect(reconstructedMessage.length).toBeGreaterThan(96);  // three keys payload + some metadata and overhead
      expect(reconstructedMessage.keyCount).toEqual(3);
      const recoveredInfos: CubeInfo[] = Array.from(reconstructedMessage.cubeInfos());
      expect(recoveredInfos.length).toEqual(3);
      expect(recoveredInfos[0].keyString).toEqual(cubeInfo1.keyString);
      expect(recoveredInfos[1].keyString).toEqual(cubeInfo2.keyString);
      expect(recoveredInfos[2].keyString).toEqual(cubeInfo3.keyString);
    }
  });

  it('should create and parse CubeRequestMessage', () => {
    // create message
    const cubeRequestMessage = new CubeRequestMessage(
      [cubeInfo1.key, cubeInfo2.key, cubeInfo3.key]);

    // test construction based on CubeKey list
    {
      expect(cubeRequestMessage.type).toEqual(MessageClass.CubeRequest);
      expect(cubeRequestMessage.value).toBeInstanceOf(Buffer);
      expect(cubeRequestMessage.length).toBeGreaterThan(96);  // three keys payload + some overhead
      expect(cubeRequestMessage.keyCount).toEqual(3);
      const recoveredKeys: CubeKey[] = Array.from(cubeRequestMessage.cubeKeys());
      expect(recoveredKeys.length).toEqual(3);
      expect(recoveredKeys[0].equals(cubeInfo1.key)).toBeTruthy();
      expect(recoveredKeys[1].equals(cubeInfo2.key)).toBeTruthy();
      expect(recoveredKeys[2].equals(cubeInfo3.key)).toBeTruthy();
    }

    // test construction based on Buffer
    {
      const reconstructedMessage = new CubeRequestMessage(cubeRequestMessage.value);
      expect(reconstructedMessage.type).toEqual(MessageClass.CubeRequest);
      expect(reconstructedMessage.value).toBeInstanceOf(Buffer);
      expect(reconstructedMessage.length).toBeGreaterThan(96);  // three keys payload + some overhead
      expect(reconstructedMessage.keyCount).toEqual(3);
      const recoveredKeys: CubeKey[] = Array.from(reconstructedMessage.cubeKeys());
      expect(recoveredKeys.length).toEqual(3);
      expect(recoveredKeys[0].equals(cubeInfo1.key)).toBeTruthy();
      expect(recoveredKeys[1].equals(cubeInfo2.key)).toBeTruthy();
      expect(recoveredKeys[2].equals(cubeInfo3.key)).toBeTruthy();
    }
  });

  it('should create and parse CubeResponseMessage', () => {
    // create message
    const cubeResponseMessage = new CubeResponseMessage(
      [cubeInfo1.binaryCube, cubeInfo2.binaryCube, cubeInfo3.binaryCube]);

    // test construction based on CubeKey list
    {
      expect(cubeResponseMessage.type).toEqual(MessageClass.CubeResponse);
      expect(cubeResponseMessage.value).toBeInstanceOf(Buffer);
      expect(cubeResponseMessage.length).toBeGreaterThan(3072);  // three cubes payload + some overhead
      expect(cubeResponseMessage.cubeCount).toEqual(3);
      const recoveredBinaryCubes: Buffer[] = Array.from(cubeResponseMessage.binaryCubes());
      expect(recoveredBinaryCubes.length).toEqual(3);
      expect(recoveredBinaryCubes[0].equals(cubeInfo1.binaryCube)).toBeTruthy();
      expect(recoveredBinaryCubes[1].equals(cubeInfo2.binaryCube)).toBeTruthy();
      expect(recoveredBinaryCubes[2].equals(cubeInfo3.binaryCube)).toBeTruthy();
      expect(recoveredBinaryCubes[2].equals(cubeInfo2.binaryCube)).toBeFalsy();
    }

    // test construction based on Buffer
    {
      const reconstructedMessage = new CubeResponseMessage(cubeResponseMessage.value);
      expect(reconstructedMessage.type).toEqual(MessageClass.CubeResponse);
      expect(reconstructedMessage.value).toBeInstanceOf(Buffer);
      expect(reconstructedMessage.length).toBeGreaterThan(3072);  // three cubes payload + some overhead
      expect(reconstructedMessage.cubeCount).toEqual(3);
      const recoveredBinaryCubes: Buffer[] = Array.from(reconstructedMessage.binaryCubes());
      expect(recoveredBinaryCubes.length).toEqual(3);
      expect(recoveredBinaryCubes[0].equals(cubeInfo1.binaryCube)).toBeTruthy();
      expect(recoveredBinaryCubes[1].equals(cubeInfo2.binaryCube)).toBeTruthy();
      expect(recoveredBinaryCubes[2].equals(cubeInfo3.binaryCube)).toBeTruthy();
      expect(recoveredBinaryCubes[2].equals(cubeInfo2.binaryCube)).toBeFalsy();
    }
  });

});


describe('ServerAddressMessage', () => {
  it('should create and parse a ServerAddressMessage', () => {
    const addr = new AddressAbstraction("/ip4/127.0.0.1/tcp/31337/ws");
    const serverAddressMessage = new ServerAddressMessage(addr);
    expect(serverAddressMessage.address).toEqual(addr);
    expect(serverAddressMessage.value).toBeInstanceOf(Buffer);
    expect(serverAddressMessage.value.length).toBeGreaterThan(27);  // 27 chars addr string + overhead

    const recovered = new ServerAddressMessage(serverAddressMessage.value);
    expect(recovered.type).toEqual(MessageClass.MyServerAddress);
    expect(recovered.address).toEqual(addr);
  });
});


describe('PeerRequestMessage', () => {
  it('should create PeerRequestMessage instance', () => {
    const peerRequestMessage = new PeerRequestMessage();
    expect(peerRequestMessage.type).toEqual(MessageClass.PeerRequest);
  });
});

describe('PeerResponseMessage', () => {
  it('should create and parse a PeerResponseMessage', () => {
    const peer1 = new Peer("ws://127.0.0.1:31337");
    const peer2 = new Peer("wss://10.1.2.3:4567");
    const peer3 = new Peer("/ip4/192.168.1.10/tcp/1337/wss");
    const peerResponseMessage = new PeerResponseMessage([peer1, peer2, peer3]);

    // test construction based on peer list
    {
      expect(peerResponseMessage.type).toEqual(MessageClass.PeerResponse);
      expect(peerResponseMessage.value).toBeInstanceOf(Buffer);
      expect(peerResponseMessage.value.length).toBeGreaterThan(60);  // must fit the three addresses above at least
      expect(peerResponseMessage.peerCount).toEqual(3);
      const restoredPeers: Peer[] = Array.from(peerResponseMessage.peers());
      expect(restoredPeers.length).toEqual(3);
      expect(restoredPeers[0]).toEqual(peer1);
      expect(restoredPeers[1]).toEqual(peer2);
      expect(restoredPeers[2]).toEqual(peer3);
    }
    // test construction based on Buffer
    {
      const reconstructedMessage = new PeerResponseMessage(peerResponseMessage.value);
      expect(reconstructedMessage.type).toEqual(MessageClass.PeerResponse);
      expect(reconstructedMessage.value).toBeInstanceOf(Buffer);
      expect(reconstructedMessage.value.length).toBeGreaterThan(60);  // must fit the three addresses above at least
      expect(reconstructedMessage.peerCount).toEqual(3);
      const restoredPeers: Peer[] = Array.from(reconstructedMessage.peers());
      expect(restoredPeers.length).toEqual(3);
      expect(restoredPeers[0]).toEqual(peer1);
      expect(restoredPeers[1]).toEqual(peer2);
      expect(restoredPeers[2]).toEqual(peer3);
    }
  });
});


describe('SubscriptionConfirmationMessage', () => {
  const singleKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x42);
  const multipleKeys = [
    Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x47),
    Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x11),
  ];
  const singleHash = Buffer.alloc(NetConstants.HASH_SIZE, 0x1337);
  const multipleHashes = [
    Buffer.alloc(NetConstants.HASH_SIZE, 0x13),
    Buffer.alloc(NetConstants.HASH_SIZE, 0x37),
  ];

  describe('Parsing a received message', () => {
    it('should parse a positive confirmation for a single key', () => {
      const buffer = Buffer.alloc(
        1 + NetConstants.CUBE_KEY_SIZE +
        NetConstants.HASH_SIZE + NetConstants.TIMESPAN_SIZE);
      buffer.writeUInt8(SubscriptionResponseCode.SubscriptionConfirmed, 0);
      singleKey.copy(buffer, 1);
      singleHash.copy(buffer, 1 + NetConstants.CUBE_KEY_SIZE);
      buffer.writeUInt16BE(3600, 1 + NetConstants.CUBE_KEY_SIZE + NetConstants.HASH_SIZE);

      const message = new SubscriptionConfirmationMessage(buffer);
      expect(message.responseCode).toEqual(SubscriptionResponseCode.SubscriptionConfirmed);
      expect(message.requestedKeyBlob).toEqual(singleKey);
      expect(message.cubesHashBlob).toEqual(singleHash);
      expect(message.subscriptionDuration).toEqual(3600*1000);
    });

    it('should parse positive confirmation for multiple keys', () => {
      const multiKeyBlob = calculateHash(Buffer.concat(multipleKeys));
      const multiHashBlob = calculateHash(Buffer.concat(multipleHashes));
      const buffer = Buffer.alloc(
        1 + NetConstants.CUBE_KEY_SIZE +
        NetConstants.HASH_SIZE + NetConstants.TIMESPAN_SIZE);
      buffer.writeUInt8(SubscriptionResponseCode.SubscriptionConfirmed, 0);
      multiKeyBlob.copy(buffer, 1);
      multiHashBlob.copy(buffer, 1 + 32);
      buffer.writeUInt16BE(7200, 1 + 32 + 32);

      const message = new SubscriptionConfirmationMessage(buffer);
      expect(message.responseCode).toEqual(SubscriptionResponseCode.SubscriptionConfirmed);
      expect(message.requestedKeyBlob).toEqual(multiKeyBlob);
      expect(message.cubesHashBlob).toEqual(multiHashBlob);
      expect(message.subscriptionDuration).toEqual(7200*1000);
    });

    it('should parse a negative confirmation', () => {
      const buffer = Buffer.alloc(1 + NetConstants.CUBE_KEY_SIZE);
      buffer.writeUInt8(SubscriptionResponseCode.SubscriptionsNotSupported, 0);
      singleKey.copy(buffer, 1);

      const message = new SubscriptionConfirmationMessage(buffer);
      expect(message.responseCode).toEqual(SubscriptionResponseCode.SubscriptionsNotSupported);
      expect(message.requestedKeyBlob).toEqual(singleKey);
      expect(message.cubesHashBlob.length).toBe(0);
      expect(message.subscriptionDuration).toBe(0);
    });
  });  // Parsing a received message

  describe('Constructing a new message locally', () => {
    it('should construct a positive confirmation for a single key', () => {
      const message = new SubscriptionConfirmationMessage(
        SubscriptionResponseCode.SubscriptionConfirmed,
        [singleKey],
        [singleHash],
        3600*1000,
      );
      expect(message.responseCode).toEqual(SubscriptionResponseCode.SubscriptionConfirmed);
      expect(message.requestedKeyBlob).toEqual(singleKey);
      expect(message.cubesHashBlob).toEqual(singleHash);
      expect(message.subscriptionDuration).toEqual(3600*1000);
      // check binary message for correctness
      const expectedBuffer = Buffer.alloc(1 + NetConstants.CUBE_KEY_SIZE + NetConstants.HASH_SIZE + NetConstants.TIMESPAN_SIZE);
      expectedBuffer.writeUInt8(SubscriptionResponseCode.SubscriptionConfirmed, 0);
      singleKey.copy(expectedBuffer, 1);
      singleHash.copy(expectedBuffer, 1 + NetConstants.CUBE_KEY_SIZE);
      expectedBuffer.writeUInt16BE(3600, 1 + NetConstants.CUBE_KEY_SIZE + NetConstants.HASH_SIZE);
      expect(message.value).toEqual(expectedBuffer);
      expect(message.value.length).toEqual(1 + NetConstants.CUBE_KEY_SIZE + NetConstants.HASH_SIZE + NetConstants.TIMESPAN_SIZE);
      expect(message.value.readUInt8(0)).toEqual(SubscriptionResponseCode.SubscriptionConfirmed);
      expect(message.value.subarray(1, 1 + NetConstants.CUBE_KEY_SIZE)).toEqual(singleKey);
      expect(message.value.subarray(1 + NetConstants.CUBE_KEY_SIZE, 1 + NetConstants.CUBE_KEY_SIZE + NetConstants.HASH_SIZE)).toEqual(singleHash);
      expect(message.value.readUInt16BE(1 + NetConstants.CUBE_KEY_SIZE + NetConstants.HASH_SIZE)).toEqual(3600);
    });

    it('should construct a positive confirmation for multiple keys', () => {
      const message = new SubscriptionConfirmationMessage(
        SubscriptionResponseCode.SubscriptionConfirmed,
        multipleKeys,
        multipleHashes,
        7200*1000,
      );
      const keyHash = calculateHash(Buffer.concat(multipleKeys));
      const cubeHash = calculateHash(Buffer.concat(multipleHashes));
      expect(message.responseCode).toEqual(SubscriptionResponseCode.SubscriptionConfirmed);
      expect(message.requestedKeyBlob).toEqual(keyHash);
      expect(message.cubesHashBlob).toEqual(cubeHash);
      expect(message.subscriptionDuration).toEqual(7200*1000);
      // check binary message for correctness
      const expectedBuffer = Buffer.alloc(1 + NetConstants.CUBE_KEY_SIZE + NetConstants.HASH_SIZE + NetConstants.TIMESPAN_SIZE);
      expectedBuffer.writeUInt8(SubscriptionResponseCode.SubscriptionConfirmed, 0);
      keyHash.copy(expectedBuffer, 1);
      cubeHash.copy(expectedBuffer, 1 + NetConstants.CUBE_KEY_SIZE);
      expectedBuffer.writeUInt16BE(7200, 1 + NetConstants.CUBE_KEY_SIZE + NetConstants.HASH_SIZE);
      expect(message.value).toEqual(expectedBuffer);
      expect(message.value.length).toEqual(1 + NetConstants.CUBE_KEY_SIZE + NetConstants.HASH_SIZE + NetConstants.TIMESPAN_SIZE);
      expect(message.value.readUInt8(0)).toEqual(SubscriptionResponseCode.SubscriptionConfirmed);
      expect(message.value.subarray(1, 1 + NetConstants.CUBE_KEY_SIZE)).toEqual(keyHash);
      expect(message.value.subarray(1 + NetConstants.CUBE_KEY_SIZE, 1 + NetConstants.CUBE_KEY_SIZE + NetConstants.HASH_SIZE)).toEqual(cubeHash);
      // TODO expect message.value to be correct
      expect(message.value.readUInt16BE(1 + NetConstants.CUBE_KEY_SIZE + NetConstants.HASH_SIZE)).toEqual(7200);
    });

    it('should construct a negative confirmation', () => {
      const message = new SubscriptionConfirmationMessage(
        SubscriptionResponseCode.RequestedKeyNotAvailable,
        [singleKey],
      );
      expect(message.responseCode).toEqual(SubscriptionResponseCode.RequestedKeyNotAvailable);
      expect(message.requestedKeyBlob).toEqual(singleKey);
      expect(message.cubesHashBlob.length).toBe(0);
      expect(message.subscriptionDuration).toBe(0);
      // check binary message for correctness
      const expectedBuffer = Buffer.alloc(1 + NetConstants.CUBE_KEY_SIZE);
      expectedBuffer.writeUInt8(SubscriptionResponseCode.RequestedKeyNotAvailable, 0);
      singleKey.copy(expectedBuffer, 1);
      expect(message.value.length).toEqual(1 + NetConstants.CUBE_KEY_SIZE);
      expectedBuffer.writeUInt8(SubscriptionResponseCode.RequestedKeyNotAvailable, 0);
      singleKey.copy(expectedBuffer, 1);
      expect(message.value.length).toEqual(1 + NetConstants.CUBE_KEY_SIZE);
      expect(message.value.readUInt8(0)).toEqual(SubscriptionResponseCode.RequestedKeyNotAvailable);
      expect(message.value.subarray(1, 1 + NetConstants.CUBE_KEY_SIZE)).toEqual(singleKey);
      expect(message.value).toEqual(expectedBuffer);
    });
  });

  describe('Edge cases and error scenarios', () => {
    it('should handle an empty buffer', () => {
      const buffer = Buffer.alloc(0);
      expect(() => new SubscriptionConfirmationMessage(buffer)).toThrow();
    });

    it('should handle a buffer with insufficient length', () => {
      const buffer = Buffer.alloc(1);
      buffer.writeUInt8(SubscriptionResponseCode.SubscriptionConfirmed, 0);
      expect(() => new SubscriptionConfirmationMessage(buffer)).toThrow();
    });
  });
});
