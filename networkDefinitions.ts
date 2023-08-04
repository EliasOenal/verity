// networkDefinitions.ts

export enum MessageClass {
    Hello = 0x00,
    HashRequest = 0x01,
    HashResponse = 0x02,
    CubeRequest = 0x03,
    CubeResponse = 0x04,
    CubeSend = 0x05
}
  
export const NetConstants =  {
    PROTOCOL_VERSION: 0x00,
    PEER_ID_SIZE: 16,
    MAX_CUBE_HASH_COUNT: 1000,
    CUBE_SIZE: 1024,
    HASH_SIZE: 32,
    PROTOCOL_VERSION_SIZE: 1,
    MESSAGE_CLASS_SIZE: 1,
    COUNT_SIZE: 4
}