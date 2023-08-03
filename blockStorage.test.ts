import exp from 'constants';
import { Block } from './block';
import { BlockStorage } from './blockStorage';

describe('blockStorage', () => {
  let blockStorage: BlockStorage;
  const validBinaryBlock = Buffer.from([
    // Protocol Version and Reserved Bits (1 byte)
    0b00000000,

    // Date (5 bytes)
    0x00, 0x00, 0x00, 0x00, 0x00,

    // Payload TLV field
    0x04, // Type: Payload
    0x0A,       // Length: 10 bytes little endian
    0x48, 0x65, 0x6C, 0x6C, 0x6F, 0x2C, 0x20, 0x77, 0x6F, 0x72, // Value: "Hello, wor"

    // Padding TLV field (remaining bytes to fill 1024)
    0x00 | 0b11, // Type: Padding
    0xEC,       // Length: 1004 bytes
    0x00, 0x00, 0x37, 0x4D, // Nonce passing challenge requirement
    // Padding data (up to index 1023) - For demonstration, all zeros
    ...Array.from({ length: 1000 }, () => 0x00),
  ])

  beforeEach(() => {
    blockStorage = new BlockStorage();
  }, 1000);

  it('should add 20 blocks to the storage and get them back', async () => {
    const promises = [];
    for (let i = 0; i < 20; i++) {
      let block = new Block();
      block.setDate(i);
      promises.push(blockStorage.addBlock(block));
    }
    
    const hashes = await Promise.all(promises);
    
    hashes.forEach((hash, i) => {
      if(!hash) throw new Error(`Hash is undefined for block ${i}`);
      let binaryData = blockStorage.getBlock(hash)?.getBinaryData();
      expect(hash).toBeInstanceOf(Buffer);
      if (hash) {
        expect(hash.length).toEqual(32);
        expect(blockStorage.getBlock(hash)?.getBinaryData()).toEqual(binaryData);
      }
    });
    
    expect(blockStorage.storage.size).toEqual(20);
  }, 15000);

  it('should add a block from binary data', async () => {
    let hash = await blockStorage.addBlock(validBinaryBlock);
    expect(hash).toBeInstanceOf(Buffer);
    if (hash) {
      expect(hash.length).toEqual(32);
      expect(blockStorage.getBlock(hash)?.getBinaryData()).toEqual(validBinaryBlock);
    }
  }, 1000);

  it('should error when adding a block with invalid binary data', async () => {
    let buffer = Buffer.alloc(1024);
    expect(await blockStorage.addBlock(buffer)).toBeUndefined();
  }, 1000);

  it('should error when getting a block with invalid hash', async () => {
    let buffer = Buffer.alloc(32);
    expect(blockStorage.getBlock(buffer)).toBeUndefined();
  }, 1000);

});