import { BaseField } from "../fields/baseField";
import { CubeError, CubeKey, CubeType, FieldError } from "../cube/cube.definitions";
import { CubeInfo } from "../cube/cubeInfo";
import { logger } from "../logger";
import { AddressAbstraction } from "../peering/addressing";
import { Peer } from "../peering/peer";
import { ApiMisuseError, Settings, VerityError } from "../settings";
import { MessageClass, NetConstants, NetworkError, NetworkMessageError, SupportedTransports } from "./networkDefinitions";

import { Buffer } from 'buffer';
import { calculateHash } from "../cube/cubeUtil";

export interface CubeFilterOptions {
  /** no more than this number of Cubes or records */
  maxCount?: number;

  /** TODO implement -- only Cubes of specified type -- keep in mind Notify Cubes have a different type */
  cubeType?: CubeType,

  /** TODO implement -- only Cubes with a hashcash level of this or higher */
  difficulty?: number,

  /** TODO implement -- only Cubes younger than this Unix timestamp */
  timeMin?: number,

  /** TODO implement -- only Cubes older than this Unix timestamp */
  timeMax?: number,

  /** only Cubes with a notification field referring to this key */
  notifies?: Buffer,

  /**
   * Request to start returning keys from this key.
   * This is currently only implemented for KeyRequests.
   * Note that this does not imply a request to sort the returned keys in any
   * way and the response can and frequently will contain keys smaller than
   * the supplied one.
   * The use case of this option is traversing a remote node's store, split
   * over multiple requests.
   **/
  startKey?: CubeKey,
}


// The following describes our wire format 1.0.
// All messages are hand-crafted.
// At some point, we should replace this mess with a new format that makes
// use of our FieldParser and allows for a more orthogonal approach, allowing
// parameters such as filters to be used in the same way for different kinds
// of messages.

/**
 * NetworkMessage is the abstract interface for all messages sent over the wire.
 * Messages are kept in their binary format (Buffer) through the value attribute,
 * and converted to model data on demand by subclass-specific methods.
 */
export abstract class NetworkMessage extends BaseField {
  static fromBinary(message: Buffer): NetworkMessage {
    const type: MessageClass = NetworkMessage.MessageClass(message);
    const value: Buffer = message.subarray(NetConstants.MESSAGE_CLASS_SIZE);
    switch (type) {
      case MessageClass.Hello:
        return new HelloMessage(value);
      case MessageClass.KeyRequest:
        return new KeyRequestMessage(value);
      case MessageClass.KeyResponse:
        return new KeyResponseMessage(value);
      case MessageClass.CubeRequest:
        return new CubeRequestMessage(value);
      case MessageClass.SubscribeCube:
        return new SubscribeCubeMessage(value, type);
      case MessageClass.SubscribeNotifications:
        return new SubscribeCubeMessage(value, type);
      case MessageClass.SubscriptionConfirmation:
        return new SubscriptionConfirmationMessage(value);
      case MessageClass.CubeResponse:
        return new CubeResponseMessage(value);
      case MessageClass.MyServerAddress:
        return new ServerAddressMessage(value);
      case MessageClass.PeerRequest:
        return new PeerRequestMessage();
      case MessageClass.PeerResponse:
        return new PeerResponseMessage(value);
      case MessageClass.NotificationRequest:
        // NotificationRequests are a special kind of CubeRequests
        return new CubeRequestMessage(value, MessageClass.NotificationRequest);
      default:
        throw new VerityError("NetworkMessage.fromBinary: Cannot parse message of unknown type " + type);
    }
  }

  static MessageClass(message: Buffer): MessageClass {
    return message.readUIntBE(0, NetConstants.MESSAGE_CLASS_SIZE);
  }
}

export class HelloMessage extends NetworkMessage {
  constructor(value: Buffer);
  constructor(peerId: Buffer);
  constructor(value: Buffer) {
    super(MessageClass.Hello, value);
  }

  get remoteId(): Buffer {
    if (this.value.length < NetConstants.PEER_ID_SIZE) {
      logger.trace(`HelloMessage.remoteId: Invalid message of length ${this.value.length} while a PeerID is ${NetConstants.PEER_ID_SIZE} long; returning undefined`);
      return undefined;
    }
    return this.value.subarray(0, NetConstants.PEER_ID_SIZE);
  }
}

export enum KeyRequestMode {
  Legacy = 0x00,
  SlidingWindow = 0x01,
  SequentialStoreSync = 0x02,
  NotificationChallenge = 0x03,
  NotificationTimestamp = 0x04,
}

export class KeyRequestMessage extends NetworkMessage {
  /**
   * The 1.0 wire format is non-orthogonal and only allowed a very limited
   * combination of filters.
   * Hopefully we'll fix that in the next one.
   */
  static filterLegal(filter: CubeFilterOptions): boolean {
    if (filter.cubeType ||
      (filter.difficulty && !filter.notifies) ||
      ((filter.timeMin || filter.timeMax) && !filter.notifies) ||
      (filter.difficulty && (filter.timeMax || filter.timeMin))
    ) {
      return false;
    } else return true; // maybe, if I didn't miss something
  }

  static compile(mode: KeyRequestMode, options: CubeFilterOptions = {}): Buffer {
    if (!KeyRequestMessage.filterLegal(options)) {
      logger.warn("KeyRequestMessage constructor: The supplied combinations of CubeFilterOptions is not supported in the 1.0 wire format, will ignore some of them. This should not happen.");  // none of that would be necessary with a proper orthogonal wire format
    }
    let bufferSize = NetConstants.KEY_REQUEST_MODE_SIZE + NetConstants.KEY_COUNT_SIZE + NetConstants.CUBE_KEY_SIZE;
    if (mode === KeyRequestMode.NotificationChallenge) {
      bufferSize += NetConstants.NOTIFY_SIZE + NetConstants.CHALLENGE_LEVEL_SIZE;
    } else if (mode === KeyRequestMode.NotificationTimestamp) {
      bufferSize += NetConstants.NOTIFY_SIZE + 2*NetConstants.TIMESTAMP_SIZE;
    }

    const buffer = Buffer.alloc(bufferSize);
    let offset = 0;

    // Write mode
    buffer.writeUIntBE(mode, offset, NetConstants.KEY_REQUEST_MODE_SIZE);
    offset += NetConstants.KEY_REQUEST_MODE_SIZE;

    // Write key count
    const keyCount = options.maxCount ?? NetConstants.MAX_CUBES_PER_MESSAGE;
    buffer.writeUIntBE(keyCount, offset, NetConstants.KEY_COUNT_SIZE);
    offset += NetConstants.KEY_COUNT_SIZE;

    // Write start key or zeros if not provided
    let startKey: CubeKey;
    if (options.startKey) {
      if (Settings.RUNTIME_ASSERTIONS && options.startKey.length !== NetConstants.CUBE_KEY_SIZE) {
        logger.trace(`KeyRequestMessage constructor: Received invalid startKey of size ${options.startKey.length}, should be ${NetConstants.CUBE_KEY_SIZE}; will start at zero instead.`);
      }
      startKey = options.startKey;
    } else {
      startKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0);
    }
    startKey.copy(buffer, offset);
    offset += NetConstants.CUBE_KEY_SIZE;

    if (mode === KeyRequestMode.NotificationChallenge ||
        mode === KeyRequestMode.NotificationTimestamp) {
      // write notification recipient key... but do some checks first
      if (options.notifies === undefined) {
        throw new ApiMisuseError("KeyRequestMessage constructor: Cannot construct a KeyRequest in a Notification mode if you don't supply the notification recipient key.");  // none of that would be necessary with a proper orthogonal wire format
      }
      if (options.notifies.length !== NetConstants.NOTIFY_SIZE) {
        throw new FieldError(`KeyRequestMessage constructor: Got invalid notify recipient of length ${options.notifies.length}, should be ${NetConstants.NOTIFY_SIZE}`);
      }
      options.notifies.copy(buffer, offset);
      offset += NetConstants.NOTIFY_SIZE;

      // if in Notification w/ Challenge constraint mode, write the minimum challenge
      if (mode === KeyRequestMode.NotificationChallenge) {
        buffer.writeUIntBE(options.difficulty ?? 0, offset, NetConstants.CHALLENGE_LEVEL_SIZE);
        offset += NetConstants.CHALLENGE_LEVEL_SIZE;
      }

      // if in Notification w/ Timestamp constraint mode, write the timestamps
      if (mode === KeyRequestMode.NotificationTimestamp) {
        buffer.writeUIntBE(options.timeMin ?? 0, offset, NetConstants.TIMESTAMP_SIZE);
        offset += NetConstants.TIMESTAMP_SIZE;
        buffer.writeUIntBE(options.timeMax ?? Math.pow(2, 8*NetConstants.TIMESTAMP_SIZE)-1, offset, NetConstants.TIMESTAMP_SIZE);
        offset += NetConstants.TIMESTAMP_SIZE;
      }
    }

    return buffer;
  }

  get mode(): KeyRequestMode {
    return this.value.readUInt8(0);
  }

  get keyCount(): number {
    return this.value.readUInt32BE(NetConstants.KEY_REQUEST_MODE_SIZE);
  }

  get startKey(): CubeKey {
    const startIndex: number =
      NetConstants.KEY_REQUEST_MODE_SIZE +
      NetConstants.KEY_COUNT_SIZE;
    const endIndex: number =
      startIndex +
      NetConstants.CUBE_KEY_SIZE;
    return this.value.subarray(startIndex, endIndex) as CubeKey;
  }

  get notifies(): Buffer {
    if (this.mode !== KeyRequestMode.NotificationChallenge &&
        this.mode !== KeyRequestMode.NotificationTimestamp) {
      return undefined;
    }
    const startIndex: number =
      NetConstants.KEY_REQUEST_MODE_SIZE +
      NetConstants.KEY_COUNT_SIZE +
      NetConstants.CUBE_KEY_SIZE;
    const endIndex: number =
      startIndex +
      NetConstants.NOTIFY_SIZE;
    if (this.value.length < endIndex) {
      logger.warn("KeyRequestMessage.notifies: Invalid KeyRequestMessage. Cannot fetch notification recipient key as message is too short.");
      return undefined;
    }
    return this.value.subarray(startIndex, endIndex);
  }

  get difficulty(): number {
    if (this.mode !== KeyRequestMode.NotificationChallenge) {
      return undefined;
    }
    const startIndex: number =
      NetConstants.KEY_REQUEST_MODE_SIZE +
      NetConstants.KEY_COUNT_SIZE +
      NetConstants.CUBE_KEY_SIZE +
      NetConstants.NOTIFY_SIZE;
    const endIndex: number =
      startIndex +
      NetConstants.CHALLENGE_LEVEL_SIZE;
    if (this.value.length < endIndex) {
      logger.warn("KeyRequestMessage.difficulty: Invalid KeyRequestMessage. Cannot fetch difficulty as message is too short.");
      return undefined;
    }
    return this.value.readUIntBE(startIndex, NetConstants.CHALLENGE_LEVEL_SIZE);
  }

  get timeMin(): number {
    if (this.mode !== KeyRequestMode.NotificationTimestamp) {
      return undefined;
    }
    const startIndex: number =
      NetConstants.KEY_REQUEST_MODE_SIZE +
      NetConstants.KEY_COUNT_SIZE +
      NetConstants.CUBE_KEY_SIZE +
      NetConstants.NOTIFY_SIZE;
    const endIndex: number =
      startIndex +
      NetConstants.TIMESTAMP_SIZE;
    if (this.value.length < endIndex) {
      logger.warn("KeyRequestMessage.timeMin: Invalid KeyRequestMessage. Cannot fetch minimum timestamp as message is too short.");
      return undefined;
    }
    return this.value.readUIntBE(startIndex, NetConstants.TIMESTAMP_SIZE);
  }

  get timeMax(): number {
    if (this.mode !== KeyRequestMode.NotificationTimestamp) {
      return undefined;
    }
    const startIndex: number =
      NetConstants.KEY_REQUEST_MODE_SIZE +
      NetConstants.KEY_COUNT_SIZE +
      NetConstants.CUBE_KEY_SIZE +
      NetConstants.NOTIFY_SIZE +
      NetConstants.TIMESTAMP_SIZE;
    const endIndex: number =
      startIndex +
      NetConstants.TIMESTAMP_SIZE;
    if (this.value.length < endIndex) {
      logger.warn("KeyRequestMessage.timeMax: Invalid KeyRequestMessage. Cannot fetch maximum timestamp as message is too short.");
      return undefined;
    }
    return this.value.readUIntBE(startIndex, NetConstants.TIMESTAMP_SIZE);
  }

  constructor(buffer: Buffer);
  constructor(mode: KeyRequestMode, options?: CubeFilterOptions);
  constructor(modeOrBuffer: KeyRequestMode|Buffer, options: CubeFilterOptions = {}) {
    if (Buffer.isBuffer(modeOrBuffer)) {
      super(MessageClass.KeyRequest, modeOrBuffer);
    } else if (modeOrBuffer in KeyRequestMode) {
      super(MessageClass.KeyRequest, KeyRequestMessage.compile(modeOrBuffer, options));
    } else {
      throw new ApiMisuseError("KeyRequestMessage constructor: Invalid first parameter, must be Buffer or KeyRequestMode.");
    }
  }
}

export class KeyResponseMessage extends NetworkMessage {
  readonly keyCount: number;
  readonly mode: KeyRequestMode;

  constructor(value: Buffer);
  constructor(mode: KeyRequestMode, cubeMetas: CubeInfo[]);
  constructor(param: Buffer | KeyRequestMode, cubeMetas?: CubeInfo[]) {
    if (Buffer.isBuffer(param)) {
      super(MessageClass.KeyResponse, param);
      this.mode = param.readUInt8(0);
      // ensure number of requests per message does not exceed maximum
      this.keyCount = Math.min(
        this.value.readUIntBE(1, NetConstants.COUNT_SIZE),
        NetConstants.MAX_CUBES_PER_MESSAGE);
    } else if (param in KeyRequestMode) {
      const mode = param;
      const CUBE_META_WIRE_SIZE =
        NetConstants.CUBE_TYPE_SIZE +
        NetConstants.CHALLENGE_LEVEL_SIZE +
        NetConstants.TIMESTAMP_SIZE +
        NetConstants.CUBE_KEY_SIZE +
        NetConstants.PMUC_UPDATE_COUNT_SIZE;
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

        value.writeUIntBE(cubeMeta.updatecount, offset, NetConstants.PMUC_UPDATE_COUNT_SIZE);
        offset += NetConstants.PMUC_UPDATE_COUNT_SIZE;
      }
      super(MessageClass.KeyResponse, value);
      this.mode = mode;
      this.keyCount = cubeMetas.length;
    } else {
      throw new ApiMisuseError("KeyResponseMessage constructor: Invalid first parameter type, must be Buffer or KeyRequestMode.");
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

          const updatecount = this.value.readUIntBE(offset, NetConstants.PMUC_UPDATE_COUNT_SIZE);
          offset += NetConstants.PMUC_UPDATE_COUNT_SIZE;

          const incomingCubeInfo = new CubeInfo({
              key: key,
              date: timestamp,
              difficulty: challengeLevel,
              cubeType: cubeType,
              updatecount: updatecount,
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

  constructor(value: Buffer, messageClass?: MessageClass);
  constructor(cubeKeys: CubeKey[], messageClass?: MessageClass);

  constructor(param: Buffer | CubeKey[], messageClass: MessageClass = MessageClass.CubeRequest) {
    if (Buffer.isBuffer(param)) {
      super(messageClass, param);
      // ensure number of requests per message does not exceed maximum
      this.keyCount = Math.min(
        this.value.readUIntBE(0, NetConstants.COUNT_SIZE),
        NetConstants.MAX_CUBES_PER_MESSAGE
      );
    } else if (Array.isArray(param)) {
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
      super(messageClass, value);
      this.keyCount = keyCount;
    } else {
      throw new ApiMisuseError("CubeRequestMessage constructor: Invalid first parameter type, must be Buffer or CubeKey[].");
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

export class SubscribeCubeMessage extends CubeRequestMessage {}
export class SubscribeNotificationsMessage extends CubeRequestMessage {}

export class CubeResponseMessage extends NetworkMessage {
  constructor(value: Buffer);
  constructor(binaryCubes: Buffer[]);

  constructor(param: Buffer | Buffer[]) {
    if (Buffer.isBuffer(param)) {
      super(MessageClass.CubeResponse, param);
    } else if (Array.isArray(param)) {
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
    } else {
      throw new ApiMisuseError("CubeResponseMessage constructor: Invalid first parameter type, must be Buffer or Buffer[].");
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
    if (Buffer.isBuffer(param)) {
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
    } else if (param instanceof AddressAbstraction) {
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
    } else {
      throw new ApiMisuseError("ServerAddressMessage constructor: Invalid first parameter type, must be Buffer or AddressAbstraction.");
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
    if (Buffer.isBuffer(param)) {
      super(MessageClass.PeerResponse, param);
    } else if (Array.isArray(param)) {
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
    } else {
      throw new ApiMisuseError("PeerResponseMessage constructor: Invalid first parameter type, must be Buffer or Peer[].");
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


export enum SubscriptionResponseCode {
  SubscriptionConfirmed = 0x01,
  SubscriptionsNotSupported = 0x02,
  SubscriptionsTemporarilyUnavailable = 0x03,
  MaximumSubscriptionsReached = 0x04,
  RequestedKeyNotAvailable = 0x10,
}


/**
 * Represents a subscription confirmation message in the network protocol.
 * This message is sent in response to a subscription request and confirms
 * whether the subscription was successful or not.
 */
export class SubscriptionConfirmationMessage extends NetworkMessage {
  /**
   * The response code indicating the status of the subscription request.
   */
  readonly responseCode: SubscriptionResponseCode;

  /**
   * The key(s) for which the subscription was requested.
   * If multiple keys were requested, this is the hash of all keys.
   */
  readonly requestedKeyBlob: Buffer;

  /**
   * The hash of the subscribed cubes.
   * If multiple cubes were subscribed, this is the hash of all subscribed cubes' hashes.
   */
  readonly cubesHashBlob: Buffer;

  /**
   * The duration of the subscription in milliseconds.
   */
  readonly subscriptionDuration: number;

  /**
   * Parse a received SubscriptionConfirmationMessage
   * @param value - The binary buffer containing the message data.
   */
  constructor(value: Buffer);

  /**
   * Build a positive locally originated SubscriptionConfirmationMessage,
   * confirming the subscription.
   * @param responseCode - Must be SubscriptionResponseCode.SubscriptionConfirmed
   * @param requestedKeys - The keys for which the subscription was requested.
   * @param subscribedCubesHashes - The hashes of the subscribed cubes.
   * @param subscriptionDuration - The duration of the subscription in milliseconds.
   */
  constructor(
    responseCode: SubscriptionResponseCode.SubscriptionConfirmed,
    requestedKeys: Buffer[],
    subscribedCubesHashes: Buffer[],
    subscriptionDuration: number,
  );

  /**
   * Build a negative locally originated SubscriptionConfirmationMessage,
   * indicating that the subscription was not successful.
   * @param responseCode - The response code indicating the status of the subscription request.
   * @param requestedKeys - The keys for which the subscription was requested.
   */
  constructor(
    responseCode: SubscriptionResponseCode,
    requestedKeys: Buffer[],
  );

  /**
   * Constructs a SubscriptionConfirmationMessage.
   * @param param - Either a binary buffer or a response code.
   * @param requestedKeys - The keys for which the subscription was requested (if param is a response code).
   * @param subscribedCubesHashes - The hashes of the subscribed cubes (if param is a response code).
   * @param subscriptionDuration - The duration of the subscription in seconds (if param is a response code).
   */
  constructor(
      param: Buffer | SubscriptionResponseCode,
      requestedKeys?: Buffer[],
      subscribedCubesHashes?: Buffer[],
      subscriptionDuration?: number,
  ) {
    if (Buffer.isBuffer(param)) {
      // Sanity check input
      if (param.length < 1 + NetConstants.CUBE_KEY_SIZE) {
        throw new NetworkMessageError(`SubscriptionConfirmationMessage: Invalid message length ${param.length}, should be >= ${1 + NetConstants.CUBE_KEY_SIZE}`);
      }
      // Parse a remotely originated message
      super(MessageClass.SubscriptionConfirmation, param);
      // Extract message data
      this.responseCode = param.readUInt8(0);
      this.requestedKeyBlob = param.subarray(1, 1 + NetConstants.CUBE_KEY_SIZE);
      if (param.length > 1 + NetConstants.CUBE_KEY_SIZE) {
        this.cubesHashBlob = param.subarray(
        1 + NetConstants.CUBE_KEY_SIZE,
        1 + NetConstants.CUBE_KEY_SIZE + NetConstants.HASH_SIZE);
        if (param.length > 1 + NetConstants.CUBE_KEY_SIZE + NetConstants.HASH_SIZE) {
          this.subscriptionDuration = param.readUInt16BE(1 + NetConstants.CUBE_KEY_SIZE + NetConstants.HASH_SIZE) * 1000;
        } else {
          this.subscriptionDuration = 0;
        }
      } else {
        this.cubesHashBlob = Buffer.alloc(0);
        this.subscriptionDuration = 0;
      }
    } else if (param in SubscriptionResponseCode) {
      // Construct a new locally originated message
      const responseCode = param;

      // Determine contents for the key(s) requested field
      let keyOutput: Buffer;
      if (requestedKeys) {
        if (requestedKeys.length === 1) {
          // If only one key is requested, use it directly
          keyOutput = requestedKeys[0];
        } else {
          // Otherwise, calculate the hash of all keys
          keyOutput = calculateHash(Buffer.concat(requestedKeys));
        }
      }

      // Determine contents for the hash(es) of subscribed cubes field
      let hashOutput: Buffer = undefined;
      if (subscribedCubesHashes) {
        if (subscribedCubesHashes.length === 1) {
          // If only one cube hash is provided, use it directly
          hashOutput = subscribedCubesHashes[0];
        } else {
          // otherwise, calculate the hash of all hashes
          hashOutput = calculateHash(Buffer.concat(subscribedCubesHashes));
        }
      }

      // Allocate a buffer for the message
      const length: number =
        1 +  // Response code
        NetConstants.CUBE_KEY_SIZE +
        (hashOutput !== undefined ? NetConstants.HASH_SIZE : 0) +
        (subscriptionDuration !== undefined ? NetConstants.TIMESPAN_SIZE : 0);
      const message = Buffer.alloc(length);
      // Write the response code to the buffer
      message.writeUInt8(responseCode, 0);
      // Copy the requested key to the buffer
      keyOutput.copy(message, 1);
      // Copy the subscribed cubes hash to the buffer
      if (hashOutput) hashOutput.copy(message, 1 + NetConstants.CUBE_KEY_SIZE);
      if (subscriptionDuration) message.writeUInt16BE(subscriptionDuration/1000, 1 + NetConstants.CUBE_KEY_SIZE + (hashOutput ? NetConstants.HASH_SIZE : 0));

      // Initialize the message with the constructed buffer
      super(MessageClass.SubscriptionConfirmation, message);
      // Set the response code, requested key, and subscribed cubes hash
      this.responseCode = responseCode;
      this.requestedKeyBlob = keyOutput ?? Buffer.alloc(0);
      this.cubesHashBlob = hashOutput ?? Buffer.alloc(0);
      this.subscriptionDuration = subscriptionDuration ?? 0;
    } else {
      throw new ApiMisuseError(`SubscriptionConfirmationMessage constructor: Invalid parameter type ${typeof param}, expected Buffer or SubscriptionResponseCode`);
    }
  }
}


