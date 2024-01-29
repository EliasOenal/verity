// cube.test.ts
import { Settings } from '../../src/core/settings';
import { unixtime } from '../../src/core/helpers';
import { NetConstants } from '../../src/core/networking/networkDefinitions';
import { BinaryLengthError, CUBE_HEADER_LENGTH, CubeType, FieldError, FieldSizeError, InsufficientDifficulty } from '../../src/core/cube/cubeDefinitions';
import { Cube } from '../../src/core/cube/cube';
import { Buffer } from 'buffer';
import { calculateHash, countTrailingZeroBits } from '../../src/core/cube/cubeUtil';
import { FieldParser } from '../../src/core/fieldParser';

import sodium, { KeyPair } from 'libsodium-wrappers'
import { CubeField, CubeFieldLength, CubeFieldType, CubeFields, coreDumbParser, coreFieldParsers, dumbFieldDefinition, mucFieldDefinition } from '../../src/core/cube/cubeFields';
import { CubeInfo } from '../../src/core/cube/cubeInfo';

const reduced_difficulty = 0;

describe('cube', () => {
  // This test parses a bit weirdly, the zero fill after the nonce decodes into additional TLV fields of length 0
  it.only('should construct a cube object from binary data.', () => {
    const cubeBuffer = Buffer.from([
      // Cube version (0) and type (basic "dumb" Cube, 0) (1 byte)
      0b00000000,

      // Payload TLV field
      CubeFieldType.PAYLOAD, // Type: Payload
      0x0A,       // Length: 10 bytes little endian
      0x48, 0x65, 0x6C, 0x6C, 0x6F, 0x2C, 0x20, 0x77, 0x6F, 0x72, // Value: "Hello, wor"

      // Date (5 bytes)
      0x00, 0x00, 0x00, 0x00, 0x00,

      // Any padding (all zeros for instance) so we end up at 1024 bytes total
      ...Array.from({ length: 1002 }, () => 0x00),

      0x00, 0x00, 0x37, 0x4D, // Nonce passing challenge requirement
    ])
    expect(() => cubeBuffer.length === 1024).toBeTruthy();
    const cube = new Cube(cubeBuffer, coreFieldParsers, reduced_difficulty);
    const fields = cube.fields.all;
    fields.forEach(field => {
      expect(field.length).toBeLessThanOrEqual(1024);
      expect(field.length).toBeGreaterThanOrEqual(0);
    }, 3000);

    expect(fields[0].type).toEqual(CubeFieldType.TYPE);

    expect(fields[1].type).toEqual(CubeFieldType.PAYLOAD);
    expect(fields[1].length).toEqual(10);
    expect(fields[1].value).toEqual(Buffer.from('Hello, wor', 'ascii'));

    expect(fields[2].type).toEqual(CubeFieldType.DATE);

    expect(fields[3].type).toEqual(CubeFieldType.NONCE);
    expect(fields[3].length).toEqual(1004);
    expect(fields[3].value).toEqual(Buffer.from([0x00, 0x00, 0x37, 0x4D]));
  }, 3000);

  it('construct a Cube object with no fields by default', () => {
    const cube = new Cube(CubeType.DUMB, coreFieldParsers, reduced_difficulty);
    expect(cube.fields.all.length).toEqual(0);
  }, 3000);

  // Can this be removed?
  // As the Cube version is now stored in the cube's first (positional)
  // field, setting it is equivalent to setting a field.
  // it.skip('should set and get the version correctly', () => {
  //   const cube = new Cube();
  //   cube.setVersion(0);
  //   expect(cube.getVersion()).toEqual(0);
  // }, 3000);

  it('should throw an error when binary data is not the correct length', () => {
    expect(() => new Cube(Buffer.alloc(512))).toThrow(BinaryLengthError);  // too short
    expect(() => new Cube(Buffer.alloc(578232))).toThrow(BinaryLengthError);  // too long
  }, 3000);

  it('should set and get the date correctly', () => {
    const cube = Cube.Dumb();
    const date = unixtime();
    cube.setDate(date);
    expect(cube.getDate()).toEqual(date);
  }, 3000);

  it('should set and get fields correctly', () => {
    const cube = new Cube(CubeType.DUMB);
    const fields = new CubeFields([
      new CubeField(CubeFieldType.PAYLOAD, 100, Buffer.alloc(100))], dumbFieldDefinition);
    cube.setFields(fields);
    expect(cube.fields).toEqual(fields);
  }, 3000);

  it('provides a convience method to sculpt a new fully valid dumb cube', () => {
    const cube = Cube.Dumb(CubeField.Payload("hello Cube"));
    expect(cube.fields.all[0].type).toEqual(CubeFieldType.TYPE);
    expect(cube.fields.all[1].type).toEqual(CubeFieldType.PAYLOAD);
    expect(cube.fields.all[2].type).toEqual(CubeFieldType.DATE);
    expect(cube.fields.all[3].type).toEqual(CubeFieldType.NONCE);
  }, 3000);

  it('should write fields to binary data correctly', async () => {
    const cube = Cube.Dumb(
      CubeField.Payload("hello Cube"), coreFieldParsers, reduced_difficulty);
    const binaryData = await cube.getBinaryData();
    expect(binaryData[0]).toEqual(CubeType.DUMB);
    expect(binaryData.subarray(1, 11).toString()).toEqual("hello Cube");
    expect(binaryData.readUInt8(7)).toEqual(100);
  }, 3000);

  it('should calculate the hash correctly', async () => {
    const cube = Cube.Dumb(undefined, coreFieldParsers, reduced_difficulty);
    const key = await cube.getKey();
    expect(key).toBeDefined();
    expect(key.length).toEqual(NetConstants.HASH_SIZE); // SHA-3-256 hash length is 32 bytes
  }, 4000);

  it('should throw an error when there is not enough space for a field value', () => {
    const cube = new Cube(CubeType.DUMB);
    const fields = new CubeFields([
      new CubeField(CubeFieldType.PAYLOAD, 8020, Buffer.alloc(8020))], dumbFieldDefinition); // Too long for the binary data
    expect(() => cube.setFields(fields)).toThrow(FieldSizeError);
  }, 3000);

  it('should accept maximum size cubes', async () => {
    // Maximum size Cube consisting of:
    // 1 byte Version/TYPE
    // 1 byte PAYLOAD header
    // ... bytes PAYLOAD value
    // 5 bytes DATE
    // 4 bytes NONCE
    const payloadLength = 1013;
    const cube = Cube.Dumb(CubeField.Payload("a".repeat(payloadLength)),
      coreFieldParsers, reduced_difficulty);
    const binaryData = await cube.getBinaryData();
    expect(binaryData.length).toEqual(1024);
  }, 3000);

  it('should create a new cube that meets the challenge requirements', async () => {
    const cube = Cube.Dumb(CubeField.Payload('Hello world, this is a payload for a cube!'));
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
  }, 3000);

  it('should correctly generate and validate MUC with manually specified fields', async () => {
    // Generate a key pair for testing
    await sodium.ready;
    const keyPair = sodium.crypto_sign_keypair();
    const publicKey: Buffer = Buffer.from(keyPair.publicKey);
    const privateKey: Buffer = Buffer.from(keyPair.privateKey);

    // Create a new MUC with specified TLV fields
    const muc = new Cube(CubeType.MUC, coreFieldParsers, reduced_difficulty);
    muc.privateKey = privateKey;

    const fields = new CubeFields([
      new CubeField(CubeFieldType.TYPE, NetConstants.CUBE_TYPE_SIZE, Buffer.alloc(NetConstants.CUBE_TYPE_SIZE)),
      new CubeField(CubeFieldType.PUBLIC_KEY, NetConstants.PUBLIC_KEY_SIZE, publicKey),
      CubeField.DateField(),
      new CubeField(CubeFieldType.SIGNATURE, 72, Buffer.alloc(72)),
      new CubeField(CubeFieldType.NONCE, Settings.NONCE_SIZE, Buffer.alloc(Settings.NONCE_SIZE)),
    ], mucFieldDefinition);

    muc.setFields(fields);
    const key = await muc.getKey();
    const info = await muc.getCubeInfo();
    const binaryData = await muc.getBinaryData();
    expect(binaryData.length).toEqual(NetConstants.CUBE_SIZE);
    expect(key.equals(publicKey)).toBeTruthy();
    expect(info).toBeInstanceOf(CubeInfo);
  }, 5000);

  // This test fails using Settings.HASH_WORKERS=true and I don't understand why :(
  it('should correctly parse and validate MUC from binary', async () => {
    // Generate a key pair for testing
    await sodium.ready;
    const keyPair = sodium.crypto_sign_keypair();
    const publicKey: Buffer = Buffer.from(keyPair.publicKey);
    const privateKey: Buffer = Buffer.from(keyPair.privateKey);

    // Create a new MUC with a random payload
    const muc = Cube.MUC(publicKey, privateKey, CubeField.Payload(
        "Ego sum MUC, peculiare informatiuncula quae a domino meo corrigi potest."),
      coreFieldParsers, reduced_difficulty);
    const key = await muc.getKey();
    expect(key).toBeInstanceOf(Buffer);

    const binMuc: Buffer = await muc.getBinaryData();
    expect(binMuc).toBeInstanceOf(Buffer);

    // Parse the MUC from binary
    const parsedMuc = new Cube(binMuc);
    expect(parsedMuc).toBeInstanceOf(Cube);
    expect(parsedMuc.publicKey.equals(publicKey)).toBeTruthy();
    expect(parsedMuc.fields.getFirst(CubeFieldType.DATE).value.equals(
      muc.fields.getFirst(CubeFieldType.DATE).value)).toBeTruthy();
    expect(parsedMuc.fields.getFirst(CubeFieldType.PAYLOAD).value.toString()).toEqual(
      "Ego sum MUC, peculiare informatiuncula quae a domino meo corrigi potest.");
  }, 5000000);

  it("should present a MUC's key even if it's hash is not yet known", async () => {
    await sodium.ready;
    const keyPair = sodium.crypto_sign_keypair();
    const publicKey: Buffer = Buffer.from(keyPair.publicKey);
    const privateKey: Buffer = Buffer.from(keyPair.privateKey);

    const muc: Cube = Cube.MUC(
      publicKey, privateKey, CubeField.Payload(
        "Signum meum nondum certum est, sed clavis mea semper eadem erit."),
      coreFieldParsers, reduced_difficulty);
    expect(muc.getKeyIfAvailable().equals(publicKey)).toBeTruthy();
    expect((await muc.getKey()).equals(publicKey)).toBeTruthy();
  })

  it('should present a valid hash for a MUC when hash is requested before binary data', async () => {
    await sodium.ready;
    const keyPair = sodium.crypto_sign_keypair();
    const publicKey: Buffer = Buffer.from(keyPair.publicKey);
    const privateKey: Buffer = Buffer.from(keyPair.privateKey);

    const muc: Cube = Cube.MUC(
      publicKey, privateKey, CubeField.Payload(
        "Gratiose tibi dabo signum meum etiamsi non intersit tibi de mea data binaria."),
      coreFieldParsers, reduced_difficulty);

    const hash: Buffer = await muc.getHash();
    const key: Buffer = await muc.getKey();
    const binaryCube = await muc.getBinaryData();

    expect(key).toEqual(publicKey);
    expect(hash).toEqual(calculateHash(binaryCube));
  }, 5000);

});
