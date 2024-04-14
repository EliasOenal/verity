import { BaseField } from "../fields/baseField";
import { CubeError, CubeKey } from "../cube/cubeDefinitions";
import { CubeInfo, CubeMeta } from "../cube/cubeInfo";
import { logger } from "../logger";
import { AddressAbstraction } from "../peering/addressing";
import { Peer } from "../peering/peer";
import { Settings, VerityError } from "../settings";
import { MessageClass, NetConstants, SupportedTransports } from "./networkDefinitions";

import { Buffer } from 'buffer';

export abstract class NetworkMessage extends BaseField {
  static fromBinary(type: MessageClass, value: Buffer): NetworkMessage {
    if (type === MessageClass.Hello) {
      return new HelloMessage(value);
    } else if (type === MessageClass.KeyRequest) {
      return new KeyRequestMessage();
    } else if (type === MessageClass.KeyResponse) {
      return new KeyResponseMessage(value);
    } else if (type === MessageClass.CubeRequest) {
      return new CubeRequestMessage(value);
    } else if (type === MessageClass.CubeResponse) {
      return new CubeResponseMessage(value);
    } else if (type === MessageClass.MyServerAddress) {
      return new ServerAddressMessage(value);
    } else if (type === MessageClass.PeerRequest) {
      return new PeerRequestMessage();
    } else if (type === MessageClass.PeerResponse) {
      return new PeerResponseMessage(value);
    } else {
      throw new VerityError("NetworkMessage.fromBinary: Cannot parse message of unknown type " + type);
    }
  }
}



export class HelloMessage extends NetworkMessage {
  constructor(value: Buffer) {
    super(MessageClass.Hello, value);
  }

  get remoteId(): Buffer {
    return this.value;
  }
}



// TODO: Support different key exchange methods
export class KeyRequestMessage extends NetworkMessage {
  constructor() {
    super(MessageClass.KeyRequest, Buffer.alloc(0));
  }
}



export class KeyResponseMessage extends NetworkMessage {
  readonly keyCount: number;

  constructor(value: Buffer);
  constructor(cubeMetas: CubeMeta[]);

  constructor(param: Buffer | CubeMeta[]) {
    if (param instanceof Buffer) {
      super(MessageClass.KeyResponse, param);
      // ensure number of requests per message does not exceed maximum
      this.keyCount = Math.min(
        this.value.readUIntBE(0, NetConstants.COUNT_SIZE),
        NetConstants.MAX_CUBES_PER_MESSAGE);
    } else {
      const cubeMetas: CubeMeta[] = param;
      const CUBE_META_WIRE_SIZE =
        NetConstants.CUBE_KEY_SIZE + NetConstants.TIMESTAMP_SIZE +
        NetConstants.CHALLENGE_LEVEL_SIZE + NetConstants.CUBE_TYPE_SIZE;
      const value = Buffer.alloc(NetConstants.COUNT_SIZE +
        cubeMetas.length * CUBE_META_WIRE_SIZE);

      let offset = 0;
      value.writeUIntBE(cubeMetas.length, offset, NetConstants.COUNT_SIZE);
      offset += NetConstants.COUNT_SIZE;

      for (const cubeMeta of cubeMetas) {
        value.writeUIntBE(cubeMeta.cubeType, offset, NetConstants.CUBE_TYPE_SIZE);
        offset += NetConstants.CUBE_TYPE_SIZE;

        value.writeUIntBE(
          cubeMeta.difficulty, offset, NetConstants.CHALLENGE_LEVEL_SIZE);
        offset += NetConstants.CHALLENGE_LEVEL_SIZE;

        // Convert the date (timestamp) to a 5-byte buffer and copy
        value.writeUIntBE(cubeMeta.date, offset, NetConstants.TIMESTAMP_SIZE);
        offset += NetConstants.TIMESTAMP_SIZE;

        cubeMeta.key.copy(value, offset);
        offset += NetConstants.CUBE_KEY_SIZE;
      }
      super(MessageClass.KeyResponse, value);
      this.keyCount = param.length;
    }
  }


  *cubeInfos(): Generator<CubeInfo> {
    let offset = NetConstants.COUNT_SIZE;
    // use plain old for loop to enforce maximum requests per message,
    // as represented by this.keyCount
    for (let i = 0; i < this.keyCount; i++) {
        const cubeType = this.value.readUIntBE(offset, NetConstants.CUBE_TYPE_SIZE);
        offset += NetConstants.CUBE_TYPE_SIZE;

        const challengeLevel = this.value.readUIntBE(
          offset, NetConstants.CHALLENGE_LEVEL_SIZE);
        offset += NetConstants.CHALLENGE_LEVEL_SIZE;

        // Read timestamp as a 5-byte number
        const timestamp = this.value.readUIntBE(offset, NetConstants.TIMESTAMP_SIZE);
        offset += NetConstants.TIMESTAMP_SIZE;

        const key = this.value.subarray(offset, offset + NetConstants.CUBE_KEY_SIZE);
        offset += NetConstants.CUBE_KEY_SIZE;
        const incomingCubeInfo = new CubeInfo({
            key: key,
            date: timestamp,
            challengeLevel: challengeLevel,
            cubeType: cubeType
        });
        yield incomingCubeInfo;
    }
  }
}



export class CubeRequestMessage extends NetworkMessage {
  readonly keyCount: number;

  constructor(value: Buffer);
  constructor(cubeKeys: CubeKey[]);

  constructor(param: Buffer | CubeKey[]) {
    if (param instanceof Buffer) {
      super(MessageClass.CubeRequest, param);
      // ensure number of requests per message does not exceed maximum
      this.keyCount = Math.min(
        this.value.readUIntBE(0, NetConstants.COUNT_SIZE),
        NetConstants.MAX_CUBES_PER_MESSAGE);
    } else {
      const keys: CubeKey[] = param;
      // ensure number of requests per message does not exceed maximum
      const keyCount = Math.min(keys.length, NetConstants.MAX_CUBES_PER_MESSAGE);
      const value: Buffer = Buffer.alloc(NetConstants.COUNT_SIZE +
        keys.length * NetConstants.HASH_SIZE);
      let offset = 0;

      value.writeUIntBE(keys.length, offset, NetConstants.COUNT_SIZE);
      offset += NetConstants.COUNT_SIZE;

      // use plain old for loop to enforce maximum requests per message,
      // as represented by keyCount
      for (let i = 0; i < keyCount; i++) {
        const key: CubeKey = keys[i];
        key.copy(value, offset);
        offset += NetConstants.HASH_SIZE;
      }
      super(MessageClass.CubeRequest, value);
      this.keyCount = keyCount;
    }
  }

  *cubeKeys(): Generator<CubeKey> {
    for (let i = 0; i < this.keyCount; i++) {
      yield this.value.subarray(
        NetConstants.COUNT_SIZE + i * NetConstants.HASH_SIZE,
        NetConstants.COUNT_SIZE + (i + 1) * NetConstants.HASH_SIZE);
  }

  }

}



export class CubeResponseMessage extends NetworkMessage {
  constructor(value: Buffer);
  constructor(binaryCubes: Buffer[]);

  constructor(param: Buffer | Buffer[]) {
    if (param instanceof Buffer) {
      super(MessageClass.CubeResponse, param);
    } else {
      // ensure number of requests per message does not exceed maximum
      const cubeCount = Math.min(
        param.length,
        NetConstants.MAX_CUBES_PER_MESSAGE);

      const value = Buffer.alloc(NetConstants.COUNT_SIZE +
        cubeCount * NetConstants.CUBE_SIZE);
      let offset = 0;

      value.writeUIntBE(cubeCount, offset, NetConstants.COUNT_SIZE);
      offset += NetConstants.COUNT_SIZE;

      // use plain old for loop to enforce maximum Cubes per message,
      // as represented by cubeCount
      for (let i = 0; i < cubeCount; i++) {
        const binaryCube = param[i];
        if (Settings.RUNTIME_ASSERTIONS &&
            binaryCube.length !== NetConstants.CUBE_SIZE) {
          throw new CubeError(`CubeResponseMessage constructor: Encountered a Cube of invalid length ${binaryCube.length}, must be ${NetConstants.CUBE_SIZE}`);
        }
        binaryCube.copy(value, offset);
        offset += NetConstants.CUBE_SIZE;
      }
      super(MessageClass.CubeResponse, value);
    }
  }

  get cubeCount(): number {
    return Math.min(
      this.value.readUintBE(0, NetConstants.COUNT_SIZE),
      NetConstants.MAX_CUBES_PER_MESSAGE);
  }

  *binaryCubes(): Generator<Buffer> {
    const cubeCount = Math.min(
      this.value.readUIntBE(0, NetConstants.COUNT_SIZE),
      NetConstants.MAX_CUBES_PER_MESSAGE);
    for (let i = 0; i < cubeCount; i++) {
        const binaryCube = this.value.subarray(
          NetConstants.COUNT_SIZE + i * NetConstants.CUBE_SIZE,  // start / offset
          NetConstants.COUNT_SIZE + (i + 1) * NetConstants.CUBE_SIZE);  // end (= start + 1 Cube)
        yield binaryCube;
    }
  }
}



export class ServerAddressMessage extends NetworkMessage {
  readonly address: AddressAbstraction;

  constructor(value: Buffer);
  constructor(address: AddressAbstraction);

  constructor(param: Buffer | AddressAbstraction) {
    if (param instanceof Buffer) {
      super(MessageClass.MyServerAddress, param);
      // parse address
      let offset = 0;
      const type: SupportedTransports = this.value.readUInt8(offset++);
      const length: number = this.value.readUInt16BE(offset); offset += 2;
      let addrString: string =
          this.value.subarray(offset, offset+length).toString('ascii');
      offset += length;
      // set address
      this.address = AddressAbstraction.CreateAddress(addrString, type);
    } else {
      // write message
      const address: AddressAbstraction = param;
      const addressString: string = address.toString();
      const message = Buffer.alloc(
          1 + // address type -- todo parametrize
          2 + // address length -- todo parametrize
          addressString.length);
      let offset = 0;
      message.writeUInt8(address.type, offset);
      offset += 1;  // todo parametrize
      message.writeUInt16BE(addressString.length, offset);
      offset += 2;  // todo parametrize
      message.write(addressString, offset, 'ascii');
      offset += addressString.length;

      super(MessageClass.MyServerAddress, message);
      this.address = address;
    }
  }
}



// TODO: Support different peer exchange methods
export class PeerRequestMessage extends NetworkMessage {
  constructor() {
    super(MessageClass.PeerRequest, Buffer.alloc(0));
  }
}



export class PeerResponseMessage extends NetworkMessage {
  constructor(value: Buffer);
  constructor(peers: Peer[]);

  constructor(param: Buffer | Peer[]) {
    if (param instanceof Buffer) {
      super(MessageClass.PeerResponse, param);
    } else {
      const peers: Peer[] = param;
      // Determine message length
      let msgLength = NetConstants.COUNT_SIZE;  // peer count field
      for (let i = 0; i < peers.length; i++) {
          msgLength += 1;  // for the address type field
          msgLength += 2;  // for the node address length field
          msgLength += peers[i].address.toString().length;
      }
      // Prepare message
      const message = Buffer.alloc(msgLength);
      let offset = 0;
      message.writeUIntBE(peers.length, offset, NetConstants.COUNT_SIZE);
      offset += NetConstants.COUNT_SIZE;
      for (const peer of peers) {
          message.writeUInt8(peer.address.type, offset++);
          message.writeUInt16BE(peer.address.toString().length, offset);
          offset += 2;
          message.write(
            peer.address.toString(),
            offset,
            peer.address.toString().length,
            'ascii');
          offset += peer.address.toString().length;
      }
      // save message
      super(MessageClass.PeerResponse, message);
    }
  }

  get peerCount(): number {
    return this.value.readUintBE(0, NetConstants.COUNT_SIZE);
  }

  *peers(): Generator<Peer> {
    let offset = 0;
    const peerCount: number = this.value.readUIntBE(offset, NetConstants.COUNT_SIZE);
    offset += NetConstants.COUNT_SIZE;
    for (let i = 0; i < peerCount; i++) {
        // read address
        const addressType: SupportedTransports = this.value.readUInt8(offset++);
        const addressLength: number = this.value.readUint16BE(offset);
        offset += 2;
        const peerAddress = this.value.subarray(offset, offset + addressLength);
        offset += addressLength;

        // construct and yield peer
        const addressAbstraction = AddressAbstraction.CreateAddress(
            peerAddress.toString(), addressType);
        if (!addressAbstraction) {
            logger.info(`PeerResponseMessage.peers(): Received *invalid* peer address ${peerAddress.toString()}`);
            continue;
        }
        logger.trace(`PeerResponseMessage.peers(): Received peer ${peerAddress.toString()} (which we parsed to ${addressAbstraction.toString()})`);
        const peer: Peer = new Peer(addressAbstraction);
        yield peer;
    }
  }
}
