import { CubeKey } from "../../../src/core/cube/cubeDefinitions";
import { Cube } from "../../../src/core/cube/cube";
import { CubeInfo } from "../../../src/core/cube/cubeInfo";
import { MessageClass } from "../../../src/core/networking/networkDefinitions";
import { NetworkMessage, HelloMessage, KeyRequestMessage, KeyResponseMessage, CubeRequestMessage, CubeResponseMessage, ServerAddressMessage, PeerRequestMessage, PeerResponseMessage, KeyRequestMode } from "../../../src/core/networking/networkMessage";
import { AddressAbstraction } from "../../../src/core/peering/addressing";
import { Peer } from "../../../src/core/peering/peer";
import { VerityError } from "../../../src/core/settings";
import { CubeField } from "../../../src/core/cube/cubeField";

describe('NetworkMessage', () => {
  it('should create instances of derived message types', () => {
    const helloMessage = NetworkMessage.fromBinary(MessageClass.Hello, Buffer.from('abcdefghijklmnop', 'ascii'));
    expect(helloMessage).toBeInstanceOf(HelloMessage);

    const keyRequestMessage = NetworkMessage.fromBinary(MessageClass.KeyRequest, Buffer.from('invalid message content, but who care'));
    expect(keyRequestMessage).toBeInstanceOf(KeyRequestMessage);

    // Add similar tests for other message types
  });

  it('should throw VerityError for unknown message type', () => {
    expect(() => NetworkMessage.fromBinary(999 as MessageClass, Buffer.from('InvalidType'))).toThrow(VerityError);
  });
});

describe('HelloMessage', () => {
  it('should have remoteId property', () => {
    const buffer = Buffer.from('abcdefghijklmnop', 'ascii');
    const helloMessage = new HelloMessage(buffer);
    expect(helloMessage.type).toEqual(MessageClass.Hello);
    expect(helloMessage.remoteId).toEqual(buffer);
  });
});

describe('KeyRequestMessage', () => {
  it('should create KeyRequestMessage instance', () => {
    const keyRequestMessage = new KeyRequestMessage(KeyRequestMode.SlidingWindow, 10);
    expect(keyRequestMessage.type).toEqual(MessageClass.KeyRequest);
  });
});

describe('KeyResponseMessage, CubeRequestMessage and CubeResponseMessage', () => {
  let cube1: Cube, cube2: Cube, cube3: Cube;
  let cubeInfo1: CubeInfo, cubeInfo2: CubeInfo, cubeInfo3: CubeInfo;

  beforeAll(async () => {
    // prepare some cube keys
    cube1 = Cube.Frozen({
      fields: CubeField.Payload("Primus cubus transmittendus est"),
      requiredDifficulty: 0,
    });
    cube2 = Cube.Frozen({
      fields: CubeField.Payload("Secundus cubus transmittendus est"),
      requiredDifficulty: 0,
    });
    cube3 = Cube.Frozen({
      fields: CubeField.Payload("Tertius cubus transmittendus est"),
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
