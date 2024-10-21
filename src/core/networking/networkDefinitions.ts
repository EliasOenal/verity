// networkDefinitions.ts
import { VerityError } from "../settings";

export enum MessageClass {
    Hello = 0x00,
    KeyRequest = 0x01,
    KeyResponse = 0x02,
    CubeRequest = 0x03,
    CubeResponse = 0x04,
    MyServerAddress = 0x05,
    PeerRequest = 0x06,
    PeerResponse = 0x07,
    NotificationRequest = 0x08,
    SubscribeCube = 0x09,
    SubscriptionConfirmation = 0x0a,
}

export const NetConstants =  {
    PROTOCOL_VERSION_SIZE: 1,
    PROTOCOL_VERSION: 0x00,
    PEER_ID_SIZE: 16,
    MAX_CUBES_PER_MESSAGE: 1000,
    MAX_NODE_ADDRESS_COUNT: 1000,
    CUBE_SIZE: 1024,
    HASH_SIZE: 32,      // TODO: HASH_SIZE may still be used instead of
    CUBE_KEY_SIZE: 32,  // CUBE_KEY_SIZE at some points
    MESSAGE_CLASS_SIZE: 1,
    FIELD_TYPE_SIZE: 1,  // note: it's actually 6 bits, with 2 bits borrowed to FIELD_LENGTH
    FIELD_LENGTH_SIZE: 1,   // note: it's actually 10 bits, with 2 bits borrowed from MESSAGE_CLASS
    RELATIONSHIP_TYPE_SIZE: 1,
    COUNT_SIZE: 4,
    TIMESTAMP_SIZE: 5,
    CUBE_TYPE_SIZE: 1,
    CHALLENGE_LEVEL_SIZE: 1,
    PUBLIC_KEY_SIZE: 32,
    SIGNATURE_SIZE: 64,
    NONCE_SIZE: 4,  // note this is misleadingly named, it is NOT the size of our cryptographic nonce but the size of the scratchpad used when calculating hash cash
    KEY_REQUEST_MODE_SIZE: 1,
    KEY_COUNT_SIZE: 4,
    ADDRESS_TYPE_SIZE: 1,
    ADDRESS_LENGTH_SIZE: 2,
    NOTIFY_SIZE: 32,  // it will not be possible to change this without breaking a lot of code, as we assume in many places that NOTIFY contains exactly one Cube key
    PMUC_UPDATE_COUNT_SIZE: 4,

    // do we want to move this to CCI?
    CRYPTO_NONCE_SIZE: 24,
    CRYPTO_SYMMETRIC_KEY_SIZE: 32,
    CRYPTO_MAC_SIZE: 16,
}

export enum SupportedTransports {
    ws = 1,
    libp2p = 2,
}

export class NetworkError extends VerityError { name = "NetworkError" }
export class NetworkPeerError extends NetworkError { name = "NetworkPeerError" }
export class NetworkMessageError extends NetworkPeerError { name = "NetworkMessageError" }
export class AddressError extends NetworkError { name = "AddressError" }
