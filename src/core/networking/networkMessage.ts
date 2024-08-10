import { BaseField } from "../fields/baseField";
import { CubeError, CubeKey } from "../cube/cube.definitions";
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
      return new KeyRequestMessage(value);
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

export enum KeyRequestMode {
  Legacy = 0x00,
  SlidingWindow = 0x01,
  SequentialStoreSync = 0x02,
}

export class KeyRequestMessage extends NetworkMessage {
  readonly mode: KeyRequestMode;
  readonly keyCount: number;
  readonly startKey: CubeKey;

  constructor(buffer: Buffer);
  constructor(mode: KeyRequestMode, keyCount: number, startKey?: CubeKey);
  constructor(modeOrBuffer: KeyRequestMode | Buffer, keyCount?: number, startKey?: CubeKey) {
    if (modeOrBuffer instanceof Buffer) {
      if (modeOrBuffer.length !== NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE + NetConstants.CUBE_KEY_SIZE) {
        throw new CubeError(`KeyRequestMessage constructor: Invalid buffer length ${modeOrBuffer.length}, must be ${NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE + NetConstants.CUBE_KEY_SIZE}`);
      }
      super(MessageClass.KeyRequest, modeOrBuffer);
      this.mode = this.value.readUInt8(0);
      this.keyCount = this.value.readUInt32BE(NetConstants.KEY_REQUEST_MODE_SIZE);
      this.startKey = this.value.subarray(NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE, NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE + NetConstants.CUBE_KEY_SIZE) as CubeKey;
    } else {
      const bufferSize = NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE + NetConstants.CUBE_KEY_SIZE;

      const buffer = Buffer.alloc(bufferSize);
      let offset = 0;

      // Write mode
      buffer.writeUInt8(modeOrBuffer, offset);
      offset += NetConstants.KEY_REQUEST_MODE_SIZE;

      // Write key count
      buffer.writeUInt32BE(keyCount!, offset);
      offset += NetConstants.KEY_COUNT_SIZE;

      // Write start key or zeros if not provided
      if (startKey) {
        startKey.copy(buffer, offset);
      } else {
        buffer.fill(0, offset, offset + NetConstants.CUBE_KEY_SIZE);
      }

      super(MessageClass.KeyRequest, buffer);
    }
  }
}

export class KeyResponseMessage extends NetworkMessage {
  readonly keyCount: number;
  readonly mode: KeyRequestMode;

  constructor(value: Buffer);
  constructor(mode: KeyRequestMode, cubeMetas: CubeMeta[]);
  constructor(param: Buffer | KeyRequestMode, cubeMetas?: CubeMeta[]) {
    if (param instanceof Buffer) {
      super(MessageClass.KeyResponse, param);
      this.mode = param.readUInt8(0);
      // ensure number of requests per message does not exceed maximum
      this.keyCount = Math.min(
        this.value.readUIntBE(1, NetConstants.COUNT_SIZE),
        NetConstants.MAX_CUBES_PER_MESSAGE);
    } else {
      const mode = param;
      const CUBE_META_WIRE_SIZE =
        NetConstants.CUBE_KEY_SIZE + NetConstants.TIMESTAMP_SIZE +
        NetConstants.CHALLENGE_LEVEL_SIZE + NetConstants.CUBE_TYPE_SIZE;
      const value = Buffer.alloc(1 + NetConstants.COUNT_SIZE +
        cubeMetas.length * CUBE_META_WIRE_SIZE);

      let offset = 0;
      value.writeUInt8(mode, offset);
      offset += NetConstants.KEY_REQUEST_MODE_SIZE;
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
      this.mode = mode;
      this.keyCount = cubeMetas.length;
    }
  }

  *cubeInfos(): Generator<CubeInfo> {
    try {
      let offset = NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.COUNT_SIZE;
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
              difficulty: challengeLevel,
              cubeType: cubeType
          });
          yield incomingCubeInfo;
      }
    }
    catch (error) {
      logger.info(`KeyResponseMessage.cubeInfos(): Error while parsing CubeInfo: ${error}, trace: ${error.stack}`);
      return;
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
        NetConstants.MAX_CUBES_PER_MESSAGE
      );
    } else {
      const keys: CubeKey[] = param;
      // ensure number of requests per message does not exceed maximum
      const keyCount = Math.min(
        keys.length,
        NetConstants.MAX_CUBES_PER_MESSAGE
      );
      const value: Buffer = Buffer.alloc(
        NetConstants.COUNT_SIZE + keys.length * NetConstants.CUBE_KEY_SIZE
      );
      let offset = 0;

      value.writeUIntBE(keys.length, offset, NetConstants.COUNT_SIZE);
      offset += NetConstants.COUNT_SIZE;

      // use plain old for loop to enforce maximum requests per message,
      // as represented by keyCount
      for (let i = 0; i < keyCount; i++) {
        const key: CubeKey = keys[i];
        key.copy(value, offset);
        offset += NetConstants.CUBE_KEY_SIZE;
      }
      super(MessageClass.CubeRequest, value);
      this.keyCount = keyCount;
    }
  }

  *cubeKeys(): Generator<CubeKey> {
    for (let i = 0; i < this.keyCount; i++) {
      yield this.value.subarray(
        NetConstants.COUNT_SIZE + i * NetConstants.CUBE_KEY_SIZE,
        NetConstants.COUNT_SIZE + (i + 1) * NetConstants.CUBE_KEY_SIZE
      );
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
        yield Buffer.from(binaryCube);
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
      const type: SupportedTransports = this.value.readUInt8(offset);
      offset += NetConstants.ADDRESS_TYPE_SIZE;
      const length: number = this.value.readUInt16BE(offset);
      offset += NetConstants.ADDRESS_LENGTH_SIZE;
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
          NetConstants.ADDRESS_TYPE_SIZE +
          NetConstants.ADDRESS_LENGTH_SIZE +
          addressString.length);
      let offset = 0;
      message.writeUInt8(address.type, offset);
      offset += NetConstants.ADDRESS_TYPE_SIZE;
      message.writeUInt16BE(addressString.length, offset);
      offset += NetConstants.ADDRESS_LENGTH_SIZE;
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
          message.writeUInt8(peer.address.type, offset);
          offset += NetConstants.ADDRESS_TYPE_SIZE;
          message.writeUInt16BE(peer.address.toString().length, offset);
          offset += NetConstants.ADDRESS_LENGTH_SIZE;
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
        const addressType: SupportedTransports = this.value.readUInt8(offset);
        offset += NetConstants.ADDRESS_TYPE_SIZE;
        const addressLength: number = this.value.readUint16BE(offset);
        offset += NetConstants.ADDRESS_LENGTH_SIZE;
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
