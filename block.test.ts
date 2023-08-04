// Block.test.ts
import { Block } from './block';
import { Buffer } from 'buffer';
import { FieldType } from './fieldProcessing';
import { countTrailingZeroBits } from './blockUtil';

describe('block', () => {
  // This test parses a bit weirdly, the zero fill after the nonce decodes into additional TLV fields of length 0
  it('should construct a Block object from binary data.', () => {
    const blockBuffer = Buffer.from([
      // Protocol Version and Reserved Bits (1 byte)
      0b00000000,

      // Date (5 bytes)
      0x00, 0x00, 0x00, 0x00, 0x00,

      // Payload TLV field
      FieldType.PAYLOAD, // Type: Payload
      0x0A,       // Length: 10 bytes little endian
      0x48, 0x65, 0x6C, 0x6C, 0x6F, 0x2C, 0x20, 0x77, 0x6F, 0x72, // Value: "Hello, wor"

      // Padding TLV field (remaining bytes to fill 1024)
      FieldType.PADDING_NONCE | 0b11, // Type: Padding
      0xEC,       // Length: 1000 bytes
      0x00, 0x00, 0x37, 0x4D, // Nonce passing challenge requirement
      // Padding data (up to index 1023) - For demonstration, all zeros
      ...Array.from({ length: 1000 }, () => 0x00),
    ])

    expect(() => blockBuffer.length === 1024).toBeTruthy();
    const block = new Block(blockBuffer);
    let fields = block.getFields();
    fields.forEach(field => {
      expect(field.length).toBeLessThanOrEqual(1024);
      expect(field.length).toBeGreaterThanOrEqual(0);
    }, 1000);

    expect(fields[0].type).toEqual(FieldType.PAYLOAD);
    expect(fields[0].length).toEqual(10);
    expect(fields[0].value).toEqual(Buffer.from('Hello, wor', 'ascii'));

    expect(fields[1].type).toEqual(FieldType.PADDING_NONCE);
    expect(fields[1].length).toEqual(1004);
    expect(fields[1].value).toEqual(Buffer.from([0x00, 0x00, 0x37, 0x4D,
      ...Array.from({ length: 1000 }, () => 0x00)]));
  }, 1000);

  it('should create a new block with default values when no binary data is provided', () => {
    const block = new Block();
    expect(block.getVersion()).toEqual(0);
    expect(block.getFields()).toEqual([{ type: FieldType.PADDING_NONCE, length: 1016, value: Buffer.alloc(1016) }]);
  }, 1000);

  it('should set and get the version correctly', () => {
    const block = new Block();
    block.setVersion(0);
    expect(block.getVersion()).toEqual(0);
  }, 1000);

  it('should throw an error when binary data is not 1024 bytes', () => {
    const binaryData = Buffer.alloc(512); // 512 bytes, not 1024
    expect(() => new Block(binaryData)).toThrowError('Block must be 1024 bytes');
  }, 1000);

  it('should set and get the date correctly', () => {
    const block = new Block();
    const date = Math.floor(Date.now() / 1000);
    block.setDate(date);
    expect(block.getDate()).toEqual(date);
  }, 1000);

  it('should set and get fields correctly', () => {
    const block = new Block();
    const fields = [{ type: FieldType.PAYLOAD, length: 100, value: Buffer.alloc(100) }];
    block.setFields(fields);
    expect(block.getFields()).toEqual(fields);
  }, 1000);

  it('should fail difficulty requirements', () => {
    const binaryData = Buffer.alloc(1024);
    // Manually set a field in the binary data for testing
    binaryData[6] = FieldType.PAYLOAD; // Type
    binaryData.writeUInt8(100, 7); // Length
    expect(() => new Block(binaryData)).toThrowError("Block does not meet difficulty requirements");
  }, 1000);

  it('should write fields to binary data correctly', () => {
    const block = new Block();
    const fields = [{ type: FieldType.PAYLOAD, length: 100, value: Buffer.alloc(100) }];
    block.setFields(fields);
    const binaryData = block.getBinaryData();
    // The type and length should be written to the binary data at index 6 and 7
    expect(binaryData[6] & 0xFC).toEqual(FieldType.PAYLOAD);
    expect(binaryData.readUInt8(7)).toEqual(100);
  }, 1000);

  it('should calculate the hash correctly', async () => {
    const block = new Block();
    const hash = await block.getHash();
    expect(hash).toBeDefined();
    expect(hash.length).toEqual(32); // SHA-3-256 hash length is 32 bytes
  }, 1000);

  it('should throw an error when there is not enough space for a field value', () => {
    const block = new Block();
    const fields = [{ type: FieldType.PAYLOAD, length: 2020, value: Buffer.alloc(2020) }]; // Too long for the binary data
    expect(() => block.setFields(fields)).toThrowError('lock: Fields are 2028 bytes but must be less than 1024 bytes');
  }, 1000);

  it('should throw an error, invalid TLV type - but already fails at difficulty check', () => {
    const binaryData = Buffer.alloc(1024);
    binaryData[6] = 0xFF; // Invalid type
    expect(() => new Block(binaryData)).toThrowError("Block does not meet difficulty requirements");
  }, 1000);

  it('should create a new block that meets the challenge requirements', async () => {
    let block: Block = new Block();
    block.setVersion(0);
    let payload: Buffer = Buffer.from('Hello world, this is a payload for a block!', 'ascii');
    block.setFields([{ type: FieldType.PAYLOAD, length: payload.length, value: payload }]);
    let hash: Buffer = await block.getHash();
    expect(hash[hash.length - 1]).toEqual(0);
  }, 1000);

  it('should count the zero bits', () => {
    expect(countTrailingZeroBits(Buffer.from("00000000000000000000000000000000000000000000000000000000000000", "hex"))).toEqual(256);
    expect(countTrailingZeroBits(Buffer.from("00000000000000000000000000000000000000000000000000000000000001", "hex"))).toEqual(0);
    expect(countTrailingZeroBits(Buffer.from("00000000000000000000000000000000000000000000000000000000000002", "hex"))).toEqual(1);
    expect(countTrailingZeroBits(Buffer.from("00000000000000000000000000000000000000000000000000000000000004", "hex"))).toEqual(2);
    expect(countTrailingZeroBits(Buffer.from("00000000000000000000000000000000000000000000000000000000000008", "hex"))).toEqual(3);
    expect(countTrailingZeroBits(Buffer.from("00000000000000000000000000000000000000000000000000000000000010", "hex"))).toEqual(4);
    expect(countTrailingZeroBits(Buffer.from("00000000000000000000000000000000000000000000000000000000000020", "hex"))).toEqual(5);
  }, 1000);
});
