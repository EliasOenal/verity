// cube.test.ts
import { BinaryLengthError, CUBE_HEADER_LENGTH, Cube, FieldSizeError, InsufficientDifficulty } from '../../src/model/cube';
import { Buffer } from 'buffer';
import { Field, FieldType, Fields } from '../../src/model/fieldProcessing';
import { calculateHash, countTrailingZeroBits } from '../../src/model/cubeUtil';
import { Settings } from '../../src/model/config';
import { NetConstants } from '../../src/model/networkDefinitions';
import * as fp from '../../src/model/fieldProcessing';

import sodium, { KeyPair } from 'libsodium-wrappers'


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
    const fields = cube.getFields().data;
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
    expect(cube.getFields().data).toEqual([new Field(FieldType.PADDING_NONCE, 1016, Buffer.alloc(1016))]);
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
    const fields = new Fields([
      new Field(FieldType.PAYLOAD, 100, Buffer.alloc(100))]);
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
    const fields = new Fields([
      new Field(FieldType.PAYLOAD, 100, Buffer.alloc(100))]);
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
    const fields = new Fields([
      new Field(FieldType.PAYLOAD, 8020, Buffer.alloc(8020))]); // Too long for the binary data
    expect(() => cube.setFields(fields)).toThrow(FieldSizeError);
  }, 1000);

  it('should throw an error, invalid TLV type - but already fails at difficulty check', () => {
    const binaryData = Buffer.alloc(1024);
    binaryData[6] = 0xFF; // Invalid type
    expect(() => new Cube(binaryData)).toThrow(InsufficientDifficulty);
  }, 1000);

  it('should automatically add extra padding when cube is too small', () => {
    const cube = new Cube();
    cube.setFields(new Fields(
      [new Field(FieldType.PAYLOAD, 128, Buffer.alloc(128))]));
    expect(cube.getFields().data.length).toEqual(2);
    expect(cube.getFields().data[0].length + cube.getFields().data[1].length).toEqual(
      NetConstants.CUBE_SIZE - CUBE_HEADER_LENGTH - fp.getFieldHeaderLength(FieldType.PAYLOAD) - fp.getFieldHeaderLength(FieldType.PADDING_NONCE));
  }, 1000);

  it('should accept maximum size cubes', () => {
    const cube = new Cube();
    const payloadLength = 500;
    const paddingLength = NetConstants.CUBE_SIZE - CUBE_HEADER_LENGTH - fp.getFieldHeaderLength(FieldType.PADDING_NONCE) -
      fp.getFieldHeaderLength(FieldType.PAYLOAD) - payloadLength;
    const cubefields: Fields = new Fields([
      new Field(
        FieldType.PAYLOAD,
        payloadLength,
        Buffer.alloc(payloadLength),
      ),
      new Field(
        FieldType.PADDING_NONCE,
        paddingLength,
        Buffer.alloc(paddingLength),
      )
    ]);
    expect(CUBE_HEADER_LENGTH + fp.getFieldHeaderLength(FieldType.PAYLOAD) + payloadLength +
      fp.getFieldHeaderLength(FieldType.PADDING_NONCE) + paddingLength).toEqual(NetConstants.CUBE_SIZE);
    cube.setFields(cubefields);
    expect(paddingLength).toBeGreaterThanOrEqual(Settings.HASHCASH_SIZE);
    expect(cube.getFields().data.length).toEqual(2);
    expect(cube.getFields().data[0].length).toEqual(payloadLength);
    expect(cube.getFields().data[1].length).toEqual(paddingLength);
  }, 1000);

  it('should enforce there is enough space left for hashcash in manually padded cubes', () => {
    const cube = new Cube();
    const payloadLength = NetConstants.CUBE_SIZE - CUBE_HEADER_LENGTH -
      fp.getFieldHeaderLength(FieldType.PAYLOAD) -
      fp.getFieldHeaderLength(FieldType.PADDING_NONCE) - 2;
    const cubefields: Fields = new Fields([
      new Field(
        FieldType.PAYLOAD,
        payloadLength,
        Buffer.alloc(payloadLength),
      ),
      new Field(
        FieldType.PADDING_NONCE,
        2,
        Buffer.alloc(2),
      )
    ]);
    expect(() => cube.setFields(cubefields)).toThrow(FieldSizeError);
  }, 1000);

  it('should enforce there is enough space left for hashcash in automatically padded cubes', () => {
    const cube = new Cube();
    const payloadLength = NetConstants.CUBE_SIZE - CUBE_HEADER_LENGTH - fp.getFieldHeaderLength(FieldType.PAYLOAD) - 2;
    const cubefields: Fields = new Fields(new Field(
        FieldType.PAYLOAD,
        payloadLength,
        Buffer.alloc(payloadLength)
      ));
    expect(() => cube.setFields(cubefields)).toThrow(FieldSizeError);
  }, 1000);

  it('should reject fringe cubes too small to be valid but too large to add padding', () => {
    // construct a fringe cube that will end up exactly 1023 bytes long -- one byte too short, but minimum padding size is 2
    const cube = new Cube();
    const padding_length = 20;
    const payloadLength = NetConstants.CUBE_SIZE - CUBE_HEADER_LENGTH -
      fp.getFieldHeaderLength(FieldType.PAYLOAD) - fp.getFieldHeaderLength(FieldType.PADDING_NONCE) -
      padding_length - 1;
    const cubefields: Fields = new Fields([
      new Field(
        FieldType.PAYLOAD,
        payloadLength,
        Buffer.alloc(payloadLength),
      ),
      new Field(
        FieldType.PADDING_NONCE,
        padding_length,
        Buffer.alloc(padding_length),
      )]);
    expect(() => cube.setFields(cubefields)).toThrow(new FieldSizeError(`Cube: Cube is too small to be valid as is but too large to add extra padding.`));
  }, 1000);

  it('should create a new cube that meets the challenge requirements', async () => {
    const cube: Cube = new Cube();
    cube.setVersion(0);
    const payload: Buffer = Buffer.from('Hello world, this is a payload for a cube!', 'ascii');
    cube.setFields(new Field(FieldType.PAYLOAD, payload.length, payload));
    const key: Buffer = await cube.getKey();
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
    muc.setCryptoKeys(publicKey, privateKey);

    const fields = new Fields([
      new Field(FieldType.TYPE_SMART_CUBE | 0b00, 0, Buffer.alloc(0)),
      new Field(FieldType.TYPE_PUBLIC_KEY, 32, publicKey),
      new Field(FieldType.PADDING_NONCE, 909, Buffer.alloc(909)),
      new Field(FieldType.TYPE_SIGNATURE, 72, Buffer.alloc(72))
    ]);

    muc.setFields(fields);
    const key = await muc.getKey();
    const info = await muc.getCubeInfo();
    expect(key).toBeDefined();
    expect(info).toBeDefined();
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
    muc.setCryptoKeys(publicKey, privateKey);

    const fields = new Fields([
      new Field(FieldType.TYPE_SMART_CUBE | 0b00, 0, Buffer.alloc(0)),
      new Field(FieldType.TYPE_PUBLIC_KEY, 32, publicKey),
      new Field(FieldType.PADDING_NONCE, 909, Buffer.alloc(909)),
      new Field(FieldType.TYPE_SIGNATURE, 72, Buffer.alloc(72)),
    ]);

    muc.setFields(fields);
    const key = await muc.getKey();
    expect(key).toBeDefined();

    const binMuc: Buffer = muc.getBinaryData();

    // Parse the MUC from binary
    const parsedMuc = new Cube(binMuc);
    expect(parsedMuc).toBeDefined();
  }, 5000);

  it('should present a valid hash for a MUC when hash is requested before binary data', async () => {
    await sodium.ready;
    const keyPair = sodium.crypto_sign_keypair();
    const publicKey: Buffer = Buffer.from(keyPair.publicKey);
    const privateKey: Buffer = Buffer.from(keyPair.privateKey);

    const muc: Cube = new Cube();
    muc.setCryptoKeys(publicKey, privateKey);
    const fields = new Fields([
      new Field(FieldType.TYPE_SMART_CUBE | 0b00, 0, Buffer.alloc(0)),
      new Field(FieldType.TYPE_PUBLIC_KEY, 32, publicKey),
      new Field(FieldType.PADDING_NONCE, 909, Buffer.alloc(909)),
      new Field(FieldType.TYPE_SIGNATURE, 72, Buffer.alloc(72))
    ]);
    muc.setFields(fields);

    const hash: Buffer = await muc.getHash();
    const key: Buffer = await muc.getKey();
    const binaryCube = muc.getBinaryData();

    expect(key).toEqual(publicKey);
    expect(hash).toEqual(calculateHash(binaryCube));
  }, 5000);

  it('should present a valid hash for a MUC even if we ask for binary data first and dont explicitly create a padding field', async () => {
    await sodium.ready;
    const keyPair = sodium.crypto_sign_keypair();
    const publicKey: Buffer = Buffer.from(keyPair.publicKey);
    const privateKey: Buffer = Buffer.from(keyPair.privateKey);

    const muc = new Cube();
    muc.setCryptoKeys(publicKey, privateKey);
    const fields = new Fields([
      new Field(fp.FieldType.TYPE_SMART_CUBE | 0b00, 0, Buffer.alloc(0)),
      new Field(fp.FieldType.TYPE_PUBLIC_KEY, 32, publicKey),
      new Field(fp.FieldType.PAYLOAD, 9, Buffer.from("Hello MUC", 'utf8')),
      new Field(fp.FieldType.TYPE_SIGNATURE, 72, Buffer.alloc(72))
    ]);

  muc.setFields(fields);

  const binaryCube = muc.getBinaryData();
  const key = await muc.getKey();
  const hash = await muc.getHash();

  expect(key).toEqual(publicKey);
  expect(hash).toEqual(calculateHash(binaryCube));
  }, 5000);

  it('should generate a valid MUC using Cube.MUC', async () => {
    await sodium.ready;
    const keyPair = sodium.crypto_sign_keypair();

    const muc: Cube = Cube.MUC(
      Buffer.from(keyPair.publicKey),
      Buffer.from(keyPair.privateKey),
      Field.Payload("just testing, nothing to see here")
    );
    const key = await muc.getKey();
    expect(key).toBeDefined();

    const binMuc: Buffer = muc.getBinaryData();

    // Parse the MUC from binary
    const parsedMuc = new Cube(binMuc);
    expect(parsedMuc).toBeDefined();
    expect(await parsedMuc.getKey()).toEqual(key);
    const parsedPayloads = parsedMuc.getFields().getFieldsByType(
      FieldType.PAYLOAD);
    expect(parsedPayloads.length).toEqual(1);
    expect(parsedPayloads[0].value.toString()).toEqual("just testing, nothing to see here");
  }, 5000);
});
