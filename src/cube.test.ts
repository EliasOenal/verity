// cube.test.ts
import { BinaryLengthError, CUBE_HEADER_LENGTH, Cube, FieldSizeError, InsufficientDifficulty } from './cube';
import { Buffer } from 'buffer';
import { FieldType } from './fieldProcessing';
import { countTrailingZeroBits } from './cubeUtil';
import sodium from 'libsodium-wrappers'
import { logger } from './logger';
import { Settings } from './config';
import { NetConstants } from './networkDefinitions';
import * as fp from './fieldProcessing';

describe('cube', () => {
  // This test parses a bit weirdly, the zero fill after the nonce decodes into additional TLV fields of length 0
  it('should construct a cube object from binary data.', () => {
    const cubeBuffer = Buffer.from([
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

    expect(() => cubeBuffer.length === 1024).toBeTruthy();
    const cube = new Cube(cubeBuffer);
    let fields = cube.getFields();
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

  it('should create a new cube with default values when no binary data is provided', () => {
    const cube = new Cube();
    expect(cube.getVersion()).toEqual(0);
    expect(cube.getFields()).toEqual([{ type: FieldType.PADDING_NONCE, length: 1016, value: Buffer.alloc(1016) }]);
  }, 1000);

  it('should set and get the version correctly', () => {
    const cube = new Cube();
    cube.setVersion(0);
    expect(cube.getVersion()).toEqual(0);
  }, 1000);

  it('should throw an error when binary data is not 1024 bytes', () => {
    const binaryData = Buffer.alloc(512); // 512 bytes, not 1024
    expect(() => new Cube(binaryData)).toThrow(BinaryLengthError);
  }, 1000);

  it('should set and get the date correctly', () => {
    const cube = new Cube();
    const date = Math.floor(Date.now() / 1000);
    cube.setDate(date);
    expect(cube.getDate()).toEqual(date);
  }, 1000);

  it('should set and get fields correctly', () => {
    const cube = new Cube();
    const fields = [{ type: FieldType.PAYLOAD, length: 100, value: Buffer.alloc(100) }];
    cube.setFields(fields);
    expect(cube.getFields()).toEqual(fields);
  }, 1000);

  it('should fail difficulty requirements', () => {
    const binaryData = Buffer.alloc(1024);
    // Manually set a field in the binary data for testing
    binaryData[6] = FieldType.PAYLOAD; // Type
    binaryData.writeUInt8(100, 7); // Length
    expect(() => new Cube(binaryData)).toThrow(InsufficientDifficulty);
  }, 1000);

  it('should write fields to binary data correctly', () => {
    const cube = new Cube();
    const fields = [{ type: FieldType.PAYLOAD, length: 100, value: Buffer.alloc(100) }];
    cube.setFields(fields);
    const binaryData = cube.getBinaryData();
    // The type and length should be written to the binary data at index 6 and 7
    expect(binaryData[6] & 0xFC).toEqual(FieldType.PAYLOAD);
    expect(binaryData.readUInt8(7)).toEqual(100);
  }, 1000);

  it('should calculate the hash correctly', async () => {
    const cube = new Cube();
    const key = await cube.getKey();
    expect(key).toBeDefined();
    expect(key.length).toEqual(32); // SHA-3-256 hash length is 32 bytes
  }, 4000);

  it('should throw an error when there is not enough space for a field value', () => {
    const cube = new Cube();
    const fields = [{ type: FieldType.PAYLOAD, length: 8020, value: Buffer.alloc(8020) }]; // Too long for the binary data
    expect(() => cube.setFields(fields)).toThrow(FieldSizeError);
  }, 1000);

  it('should throw an error, invalid TLV type - but already fails at difficulty check', () => {
    const binaryData = Buffer.alloc(1024);
    binaryData[6] = 0xFF; // Invalid type
    expect(() => new Cube(binaryData)).toThrow(InsufficientDifficulty);
  }, 1000);

  it('should automatically add extra padding when cube is too small', () => {
    const cube = new Cube();
    cube.setFields([
      {
          type: FieldType.PAYLOAD,
          length: 128,
          value: Buffer.alloc(128),
      }
    ]);
    expect(cube.getFields().length).toEqual(2);
    expect(cube.getFields()[0].length + cube.getFields()[1].length).toEqual(
      NetConstants.CUBE_SIZE - CUBE_HEADER_LENGTH - fp.getFieldHeaderLength(FieldType.PAYLOAD) - fp.getFieldHeaderLength(FieldType.PADDING_NONCE));
  }, 1000);

  it('should accept maximum size cubes', () => {
    const cube = new Cube();
    const payloadLength = 500;
    const paddingLength = NetConstants.CUBE_SIZE - CUBE_HEADER_LENGTH - fp.getFieldHeaderLength(FieldType.PADDING_NONCE) -
      fp.getFieldHeaderLength(FieldType.PAYLOAD) - payloadLength;
    const cubefields: Array<fp.Field> = [
      {
          type: FieldType.PAYLOAD,
          length: payloadLength,
          value: Buffer.alloc(payloadLength),
      },
      {
        type: FieldType.PADDING_NONCE,
        length: paddingLength,
        value: Buffer.alloc(paddingLength),
      }
    ];
    expect(CUBE_HEADER_LENGTH + fp.getFieldHeaderLength(FieldType.PAYLOAD) + payloadLength +
            fp.getFieldHeaderLength(FieldType.PADDING_NONCE) + paddingLength).toEqual(NetConstants.CUBE_SIZE);
    cube.setFields(cubefields);
    expect(paddingLength).toBeGreaterThanOrEqual(Settings.HASHCASH_SIZE);
    expect(cube.getFields().length).toEqual(2);
    expect(cube.getFields()[0].length).toEqual(payloadLength);
    expect(cube.getFields()[1].length).toEqual(paddingLength);
  }, 1000);

  it('should enforce there is enough space left for hashcash in manually padded cubes', () => {
    const cube = new Cube();
    const payloadLength = NetConstants.CUBE_SIZE - CUBE_HEADER_LENGTH -
      fp.getFieldHeaderLength(FieldType.PAYLOAD) -
      fp.getFieldHeaderLength(FieldType.PADDING_NONCE) - 2;
    const cubefields: Array<fp.Field> = [
      {
          type: FieldType.PAYLOAD,
          length: payloadLength,
          value: Buffer.alloc(payloadLength),
      },
      {
        type: FieldType.PADDING_NONCE,
        length: 2,
        value: Buffer.alloc(2),
      }
    ];
    expect(() => cube.setFields(cubefields)).toThrow(FieldSizeError);
  }, 1000);

  it('should enforce there is enough space left for hashcash in automatically padded cubes', () => {
    const cube = new Cube();
    const payloadLength = NetConstants.CUBE_SIZE - CUBE_HEADER_LENGTH - fp.getFieldHeaderLength(FieldType.PAYLOAD) - 2;
    const cubefields: Array<fp.Field> = [
      {
          type: FieldType.PAYLOAD,
          length: payloadLength,
          value: Buffer.alloc(payloadLength),
      },
    ];
    expect(() => cube.setFields(cubefields)).toThrow(FieldSizeError);
  }, 1000);

  it('should reject fringe cubes too small to be valid but too large to add padding', () => {
    // construct a fringe cube that will end up exactly 1023 bytes long -- one byte too short, but minimum padding size is 2
    const cube = new Cube();
    const padding_length = 20;
    const payloadLength = NetConstants.CUBE_SIZE - CUBE_HEADER_LENGTH -
      fp.getFieldHeaderLength(FieldType.PAYLOAD) - fp.getFieldHeaderLength(FieldType.PADDING_NONCE) -
      padding_length - 1;
    const cubefields: Array<fp.Field> = [
      {
          type: FieldType.PAYLOAD,
          length: payloadLength,
          value: Buffer.alloc(payloadLength),
      },
      {
        type: FieldType.PADDING_NONCE,
        length: padding_length,
        value: Buffer.alloc(padding_length),
      }
    ];
    expect(() => cube.setFields(cubefields)).toThrow(new FieldSizeError(`Cube: Cube is too small to be valid as is but too large to add extra padding.`));
  }, 1000);

  it('should create a new cube that meets the challenge requirements', async () => {
    let cube: Cube = new Cube();
    cube.setVersion(0);
    let payload: Buffer = Buffer.from('Hello world, this is a payload for a cube!', 'ascii');
    cube.setFields([{ type: FieldType.PAYLOAD, length: payload.length, value: payload }]);
    let key: Buffer = await cube.getKey();
    expect(key[key.length - 1]).toEqual(0);
  }, 5000);

  it('should count the zero bits', () => {
    expect(countTrailingZeroBits(Buffer.from("00000000000000000000000000000000000000000000000000000000000000", "hex"))).toEqual(256);
    expect(countTrailingZeroBits(Buffer.from("00000000000000000000000000000000000000000000000000000000000001", "hex"))).toEqual(0);
    expect(countTrailingZeroBits(Buffer.from("00000000000000000000000000000000000000000000000000000000000002", "hex"))).toEqual(1);
    expect(countTrailingZeroBits(Buffer.from("00000000000000000000000000000000000000000000000000000000000004", "hex"))).toEqual(2);
    expect(countTrailingZeroBits(Buffer.from("00000000000000000000000000000000000000000000000000000000000008", "hex"))).toEqual(3);
    expect(countTrailingZeroBits(Buffer.from("00000000000000000000000000000000000000000000000000000000000010", "hex"))).toEqual(4);
    expect(countTrailingZeroBits(Buffer.from("00000000000000000000000000000000000000000000000000000000000020", "hex"))).toEqual(5);
  }, 1000);

  it('should correctly generate and validate MUC with specified TLV fields', async () => {
    // Generate a key pair for testing
    const keyPair = sodium.crypto_sign_keypair();
    const publicKey: Buffer = Buffer.from(keyPair.publicKey);
    const privateKey: Buffer = Buffer.from(keyPair.privateKey);

    // Create a new MUC with specified TLV fields
    const muc = new Cube();
    muc.setKeys(publicKey, privateKey);

    const fields = [
      { type: FieldType.TYPE_SMART_CUBE | 0b00, length: 0, value: Buffer.alloc(0) },
      { type: FieldType.TYPE_PUBLIC_KEY, length: 32, value: publicKey },
      { type: FieldType.PADDING_NONCE, length: 909, value: Buffer.alloc(909) },
      { type: FieldType.TYPE_SIGNATURE, length: 72, value: Buffer.alloc(72) }];

    muc.setFields(fields);
    const key = await muc.getKey();
    expect(key).toBeDefined();
  }, 5000);

  // This test fails using Settings.HASH_WORKERS=true and I don't understand why :(
  it('should correctly parse and validate MUC from binary', async () => {
    // Generate a key pair for testing
    await sodium.ready;
    const keyPair = sodium.crypto_sign_keypair();
    const publicKey: Buffer = Buffer.from(keyPair.publicKey);
    const privateKey: Buffer = Buffer.from(keyPair.privateKey);

    // Create a new MUC with specified TLV fields
    const muc = new Cube();
    muc.setKeys(publicKey, privateKey);

    const fields = [
      { type: FieldType.TYPE_SMART_CUBE | 0b00, length: 0, value: Buffer.alloc(0) },
      { type: FieldType.TYPE_PUBLIC_KEY, length: 32, value: publicKey },
      { type: FieldType.PADDING_NONCE, length: 909, value: Buffer.alloc(909) },
      { type: FieldType.TYPE_SIGNATURE, length: 72, value: Buffer.alloc(72) }];

    muc.setFields(fields);
    const key = await muc.getKey();
    expect(key).toBeDefined();

    const binMuc: Buffer = muc.getBinaryData();

    // Parse the MUC from binary
    const parsedMuc = new Cube(binMuc);
    expect(parsedMuc).toBeDefined();
  }, 5000);
});
