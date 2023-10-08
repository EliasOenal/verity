// networkDefinitions.ts

export enum MessageClass {
    Hello = 0x00,
    HashRequest = 0x01,
    HashResponse = 0x02,
    CubeRequest = 0x03,
    CubeResponse = 0x04,
    MyServerAddress = 0x05,
    NodeRequest = 0x06,
    NodeResponse = 0x07,
}

export const NetConstants =  {
    PROTOCOL_VERSION: 0x00,
    PEER_ID_SIZE: 16,
    MAX_CUBE_HASH_COUNT: 1000,
    MAX_NODE_ADDRESS_COUNT: 1000,
    CUBE_SIZE: 1024,
    HASH_SIZE: 32,      // TODO: HASH_SIZE may still be used instead of
    CUBE_KEY_SIZE: 32,  // CUBE_KEY_SIZE at some points
    PROTOCOL_VERSION_SIZE: 1,
    MESSAGE_CLASS_SIZE: 1,  // note: it's actually 6 bits, with 2 bits borrowed to FIELD_LENGTH
    FIELD_LENGTH_SIZE: 1,   // note: it's actually 10 bits, with 2 bits borrowed from MESSAGE_CLASS
    RELATIONSHIP_TYPE_SIZE: 1,
    COUNT_SIZE: 4,
    FINGERPRINT_SIZE: 8,
    TIMESTAMP_SIZE: 5,
    CUBE_TYPE_SIZE: 1,
    CHALLENGE_LEVEL_SIZE: 1,
    PUBLIC_KEY_SIZE: 32,
    SIGNATURE_SIZE: 72,
}