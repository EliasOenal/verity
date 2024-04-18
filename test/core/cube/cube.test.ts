// cube.test.ts
import { Settings } from '../../../src/core/settings';
import { NetConstants } from '../../../src/core/networking/networkDefinitions';

import { unixtime } from '../../../src/core/helpers';
import { BaseField } from '../../../src/core/fields/baseField';
import { BaseFields } from '../../../src/core/fields/baseFields';
import { FieldParser } from '../../../src/core/fields/fieldParser';

import { BinaryLengthError, CubeSignatureError, CubeType, FieldError, FieldSizeError, InsufficientDifficulty } from '../../../src/core/cube/cubeDefinitions';
import { Cube, coreTlvCubeFamily } from '../../../src/core/cube/cube';
import { calculateHash, countTrailingZeroBits } from '../../../src/core/cube/cubeUtil';
import { CubeFieldType, CubeField, CubeFieldLength } from '../../../src/core/cube/cubeField';
import { CubeFields, coreFrozenFieldDefinition, coreMucFieldDefinition } from '../../../src/core/cube/cubeFields';
import { CubeInfo } from '../../../src/core/cube/cubeInfo';

import { Buffer } from 'buffer';
import sodium from 'libsodium-wrappers-sumo'

// TODO: Add more tests. This is one of our most crucial core classes and it's
// nowhere near fully covered.

describe('cube', () => {
  const reducedDifficulty = 0;

  // TODO: Update payload field ID. Make tests actually check payload.
  const validBinaryCube =  Buffer.from([
    // Cube version (1) (half byte), Cube type (basic "frozen" Cube, 0) (half byte)
    0x10,

    // Payload TLV field
    0x04,  // payload field type is 4 (1 byte)
    0x14,  // payload length is 20 chars (1 byte)
    0x43, 0x75, 0x62, 0x75, 0x73, 0x20, // "Cubus "
    0x64, 0x65, 0x6d, 0x6f, 0x6e, 0x73, 0x74, 0x72,
    0x61, 0x74, 0x69, 0x76, 0x75, 0x73, // "demonstrativus"

    // Padding: padding is TLV field type 2 (6 bits), padding length is 990 (10 bits)
    0b00001011, 0b11011110,
    // 990 bytes of padding, all zeros for this example
    ...Array.from({ length: 990 }, () => 0x00),

    // Date (5 bytes)
    0x00, 0x65, 0xba, 0x8e, 0x38,
    0x00, 0x00, 0x00, 0xed  // Nonce passing challenge requirement
  ]);

  describe('construction', () => {
    // This test parses a bit weirdly, the zero fill after the nonce decodes into additional TLV fields of length 0
    it('should construct a cube object from binary data.', () => {
      expect(() => validBinaryCube.length === 1024).toBeTruthy();
      const cube = new Cube(validBinaryCube);
      const fields = cube.fields.all;
      fields.forEach(field => {
        expect(field.length).toBeLessThanOrEqual(1024);
        expect(field.length).toBeGreaterThanOrEqual(0);
      }, 3000);

      expect(fields[0].type).toEqual(CubeFieldType.TYPE);

      expect(fields[1].type).toEqual(CubeFieldType.DATE);

      expect(fields[2].type).toEqual(CubeFieldType.NONCE);
      expect(fields[2].length).toEqual(4);
      expect(fields[2].value).toEqual(Buffer.from([0x00, 0x00, 0x00, 0xed]));
    }, 3000);

    it('construct a Cube object with no fields by default', () => {
      const cube = new Cube(CubeType.FROZEN);
      expect(cube.fields.all.length).toEqual(0);
    }, 3000);

    it('should throw an error when binary data is not the correct length', () => {
      expect(() => new Cube(Buffer.alloc(512))).toThrow(BinaryLengthError);  // too short
      expect(() => new Cube(Buffer.alloc(578232))).toThrow(BinaryLengthError);  // too long
    }, 3000);

    // TODO: this test is overly broad, as demonstrated by the fact that it did
    // not break when switching from Cube0.2 to Cube1.0
    it('should accept maximum size cubes', async () => {
      // Maximum size Cube consisting of:
      // 1 byte Version/TYPE
      // 2 byte PAYLOAD type+length
      // ... bytes PAYLOAD value
      // 5 bytes DATE
      // 4 bytes NONCE
      const payloadLength = 1012;
      const cube = Cube.Frozen({
        fields: CubeField.Payload("a".repeat(payloadLength)),
        requiredDifficulty: reducedDifficulty});
      const binaryData = await cube.getBinaryData();
      expect(binaryData.length).toEqual(1024);
    }, 3000);
  });  // construction


  describe('setters and getters', () => {
    it('should set and get fields correctly', () => {
      const cube = new Cube(CubeType.FROZEN);
      const fields = new CubeFields([
        CubeField.Type(CubeType.FROZEN),
        CubeField.Payload("Ero celeber Cubus cum compilatus fuero."),
        CubeField.Date(),
        CubeField.Nonce(),
      ], coreFrozenFieldDefinition);
      cube.setFields(fields);
      expect(cube.fields).toEqual(fields);
      expect(cube.fields.getFirst(CubeFieldType.PAYLOAD).value.toString()).toEqual(
        "Ero celeber Cubus cum compilatus fuero.");
    }, 3000);

    it('should throw an error when there is not enough space for a field value', () => {
      const cube = new Cube(CubeType.FROZEN);
      const fields = new CubeFields([
        CubeField.Type(CubeType.FROZEN),
        new CubeField(CubeFieldType.PAYLOAD, Buffer.alloc(8020)),
        CubeField.Date(),
        CubeField.Nonce()
      ], coreFrozenFieldDefinition); // Too long for the binary data
      expect(() => cube.setFields(fields)).toThrow(FieldSizeError);
    }, 3000);

    it('should set and get the date correctly', () => {
      const cube = Cube.Frozen();
      const date = unixtime();
      cube.setDate(date);
      expect(cube.getDate()).toEqual(date);
    }, 3000);
  });  // setters and getters


  describe('static methods', () => {
    it('provides a convience method to sculpt a new fully valid frozen cube', () => {
      const cube = Cube.Frozen({fields: CubeField.Payload("hello Cube")});
      expect(cube.fields.all[0].type).toEqual(CubeFieldType.TYPE);
      expect(cube.fields.all[1].type).toEqual(CubeFieldType.PAYLOAD);
      expect(cube.fields.all[2].type).toEqual(CubeFieldType.DATE);
      expect(cube.fields.all[3].type).toEqual(CubeFieldType.NONCE);
    }, 3000);
  });  // static methods


  describe('compilation', () => {
    it('should write fields to binary data correctly even after manipulating them', async () => {
      const cube = Cube.Frozen({
        fields: CubeField.Payload(Buffer.alloc(500, " ")),
        requiredDifficulty: reducedDifficulty});
      cube.fields.getFirst(CubeFieldType.PAYLOAD).value.write(
        'Ego sum determinavit tarde quid dicere Cubus.', 'ascii');
      const binaryData = await cube.getBinaryData();
      expect(binaryData[0]).toEqual(CubeType.FROZEN);
      const parser = new FieldParser(coreFrozenFieldDefinition);  // decompileTlv is true
      const recontructed: BaseFields = parser.decompileFields(binaryData);
      const reconstructed_payload: BaseField = recontructed.getFirst(CubeFieldType.PAYLOAD);
      const reconstructed_string = reconstructed_payload.value.toString('ascii').trim();
      expect(reconstructed_string).toEqual(
        'Ego sum determinavit tarde quid dicere Cubus.');
    }, 3000);
  });


  describe('hashing', () => {
    it('should calculate the hash correctly', async () => {
      const cube = Cube.Frozen({requiredDifficulty: reducedDifficulty});
      const key = await cube.getKey();
      expect(key).toBeDefined();
      expect(key.length).toEqual(NetConstants.HASH_SIZE); // SHA-3-256 hash length is 32 bytes
    }, 4000);

    it('should count the zero bits', () => {
      expect(countTrailingZeroBits(Buffer.from("00000000000000000000000000000000000000000000000000000000000000", "hex"))).toEqual(256);
      expect(countTrailingZeroBits(Buffer.from("00000000000000000000000000000000000000000000000000000000000001", "hex"))).toEqual(0);
      expect(countTrailingZeroBits(Buffer.from("00000000000000000000000000000000000000000000000000000000000002", "hex"))).toEqual(1);
      expect(countTrailingZeroBits(Buffer.from("00000000000000000000000000000000000000000000000000000000000004", "hex"))).toEqual(2);
      expect(countTrailingZeroBits(Buffer.from("00000000000000000000000000000000000000000000000000000000000008", "hex"))).toEqual(3);
      expect(countTrailingZeroBits(Buffer.from("00000000000000000000000000000000000000000000000000000000000010", "hex"))).toEqual(4);
      expect(countTrailingZeroBits(Buffer.from("00000000000000000000000000000000000000000000000000000000000020", "hex"))).toEqual(5);
    }, 3000);

    it('should create a new cube that meets the challenge requirements', async () => {
      const cube = Cube.Frozen({
        fields: CubeField.Payload('Hello world, this is a payload for a cube!')
      });
      const key: Buffer = await cube.getKey();
      expect(key[key.length - 1]).toEqual(0);  // == min 8 bits difficulty
    }, 5000);
  });

  describe('basic MUC handling', () => {
    it('should correctly generate and validate MUC with manually specified fields', async () => {
      // Generate a key pair for testing
      await sodium.ready;
      const keyPair = sodium.crypto_sign_keypair();
      const publicKey: Buffer = Buffer.from(keyPair.publicKey);
      const privateKey: Buffer = Buffer.from(keyPair.privateKey);

      // Create a new MUC with specified TLV fields
      const muc = new Cube(CubeType.MUC, {requiredDifficulty: reducedDifficulty});
      muc.privateKey = privateKey;

      const fields = new CubeFields([
        new CubeField(CubeFieldType.TYPE, Buffer.alloc(NetConstants.CUBE_TYPE_SIZE)),
        new CubeField(CubeFieldType.PUBLIC_KEY, publicKey),
        CubeField.Date(),
        new CubeField(CubeFieldType.SIGNATURE, Buffer.alloc(NetConstants.SIGNATURE_SIZE)),
        new CubeField(CubeFieldType.NONCE, Buffer.alloc(Settings.NONCE_SIZE)),
      ], coreMucFieldDefinition);

      muc.setFields(fields);
      const key = await muc.getKey();
      const info = await muc.getCubeInfo();
      const binaryData = await muc.getBinaryData();
      expect(binaryData.length).toEqual(NetConstants.CUBE_SIZE);
      expect(key.equals(publicKey)).toBeTruthy();
      expect(info).toBeInstanceOf(CubeInfo);
      // @ts-ignore using a private method for testing only
      expect(() => muc.validateCube()).not.toThrow();
    }, 5000);

    it('should correctly sign a MUC', async() => {
      // Generate a key pair for testing
      await sodium.ready;
      const keyPair = sodium.crypto_sign_keypair();
      const publicKey: Buffer = Buffer.from(keyPair.publicKey);
      const privateKey: Buffer = Buffer.from(keyPair.privateKey);

      const muc = Cube.MUC(
        publicKey, privateKey, {
          fields: CubeField.Payload(
            "Ego sum cubus usoris mutabilis, semper secure signatus."),
          requiredDifficulty: reducedDifficulty
      });
      const binaryData = await muc.getBinaryData();  // final fully signed binary
      const mucKey: Buffer = await muc.getKey();

      // ensure signature exposed through the Cube object's signature field matches
      // the actualy one in the binary data
      const sigField = muc.fields.getFirst(CubeFieldType.SIGNATURE);
      const sigFromBinary: Buffer = binaryData.subarray(956, 1020);
      expect(sigField.value.equals(sigFromBinary)).toBeTruthy();

      // verify public key has correctly been transferred to field and binary data
      const pubkeyField = muc.fields.getFirst(CubeFieldType.PUBLIC_KEY);
      expect(pubkeyField.value.equals(
        publicKey)).toBeTruthy();
      expect(binaryData.subarray(
        pubkeyField.start,
        pubkeyField.start + CubeFieldLength[CubeFieldType.PUBLIC_KEY]).
        equals(publicKey)).toBeTruthy();

      // verify signature is correct, manually...
      const dataToSign = binaryData.subarray(0, 956);  // 956 = 1024 - 4 (nonce) - 64 (signature proper)
      expect(
        sodium.crypto_sign_verify_detached(sigField.value, dataToSign, publicKey))
        .toBeTruthy();
      // @ts-ignore ...and automatically (using private method here)
      expect(() => muc.validateCube()).not.toThrow();
      // try to re-instantiate

      const parsedMuc = new Cube(binaryData);
      expect(parsedMuc).toBeInstanceOf(Cube);
      expect(parsedMuc.getKeyIfAvailable().equals(mucKey)).toBeTruthy();
    });

    // This test fails using Settings.HASH_WORKERS=true and I don't understand why :(
    it('should correctly parse MUC from binary', async () => {
      // Generate a key pair for testing
      await sodium.ready;
      const keyPair = sodium.crypto_sign_keypair();
      const publicKey: Buffer = Buffer.from(keyPair.publicKey);
      const privateKey: Buffer = Buffer.from(keyPair.privateKey);

      // Create a new MUC with a random payload
      const muc = Cube.MUC(publicKey, privateKey, {
        fields: CubeField.Payload(
          "Ego sum cubus usoris mutabilis, peculiare informatiuncula quae a domino meo corrigi potest."),
        requiredDifficulty: reducedDifficulty
      });
      const key = await muc.getKey();
      expect(key).toBeInstanceOf(Buffer);

      const binMuc: Buffer = await muc.getBinaryData();
      expect(binMuc).toBeInstanceOf(Buffer);

      // Do a core-only parsing from binary which will ignore TLV fields
      const coreParsedMuc = new Cube(binMuc);
      expect(coreParsedMuc).toBeInstanceOf(Cube);
      expect(coreParsedMuc.fields.all.length).toEqual(5);
      expect(coreParsedMuc.fields.all[0].type).toEqual(CubeFieldType.TYPE);
      expect(coreParsedMuc.fields.all[1].type).toEqual(CubeFieldType.PUBLIC_KEY);
      expect(coreParsedMuc.fields.all[2].type).toEqual(CubeFieldType.DATE);
      expect(coreParsedMuc.fields.all[3].type).toEqual(CubeFieldType.SIGNATURE);
      expect(coreParsedMuc.fields.all[4].type).toEqual(CubeFieldType.NONCE);
      expect(coreParsedMuc.publicKey.equals(publicKey)).toBeTruthy();
      expect(coreParsedMuc.fields.getFirst(CubeFieldType.DATE).value.equals(
        muc.fields.getFirst(CubeFieldType.DATE).value)).toBeTruthy();

      // Do a full parsing from binary including TLV
      const fullyParsedMuc = new Cube(binMuc, {family: coreTlvCubeFamily});
      const backPos = fullyParsedMuc.fields.all.length;
      expect(fullyParsedMuc).toBeInstanceOf(Cube);
      expect(fullyParsedMuc.fields.all.length).toBeGreaterThanOrEqual(7);
      expect(fullyParsedMuc.fields.all[0].type).toEqual(CubeFieldType.TYPE);
      expect(fullyParsedMuc.fields.all[1].type).toEqual(CubeFieldType.PAYLOAD);
      expect(fullyParsedMuc.fields.all[2].type).toEqual(CubeFieldType.CCI_END);
      expect(fullyParsedMuc.fields.all[backPos-4].type).toEqual(CubeFieldType.PUBLIC_KEY);
      expect(fullyParsedMuc.fields.all[backPos-3].type).toEqual(CubeFieldType.DATE);
      expect(fullyParsedMuc.fields.all[backPos-2].type).toEqual(CubeFieldType.SIGNATURE);
      expect(fullyParsedMuc.fields.all[backPos-1].type).toEqual(CubeFieldType.NONCE);
      expect(fullyParsedMuc.publicKey.equals(publicKey)).toBeTruthy();
      expect(fullyParsedMuc.fields.getFirst(CubeFieldType.DATE).value.equals(
        muc.fields.getFirst(CubeFieldType.DATE).value)).toBeTruthy();
      expect(fullyParsedMuc.fields.getFirst(CubeFieldType.PAYLOAD).value.toString()).toEqual(
        "Ego sum cubus usoris mutabilis, peculiare informatiuncula quae a domino meo corrigi potest.");
    }, 5000000);

    it('should reject a binary MUC with invalid signature', async() => {
      // Generate a key pair for testing
      await sodium.ready;
      const keyPair = sodium.crypto_sign_keypair();
      const publicKey: Buffer = Buffer.from(keyPair.publicKey);
      const privateKey: Buffer = Buffer.from(keyPair.privateKey);

      // Sculpt MUC
      const muc = Cube.MUC(
        publicKey, privateKey, {
          fields: CubeField.Payload(
            "Ego sum cubus usoris mutabilis qui male tactus est."),
          requiredDifficulty: reducedDifficulty
      });
      const binaryData = await muc.getBinaryData();  // final fully signed binary

      // Manipulate binary data
      binaryData[4] = 42;  // not the right answer after all

      // Attempt to restore MUC
      expect(() => new Cube(binaryData)).toThrow(CubeSignatureError);
    })

    it("should present a MUC's key even if it's hash is not yet known", async () => {
      await sodium.ready;
      const keyPair = sodium.crypto_sign_keypair();
      const publicKey: Buffer = Buffer.from(keyPair.publicKey);
      const privateKey: Buffer = Buffer.from(keyPair.privateKey);

      const muc: Cube = Cube.MUC(
        publicKey, privateKey, {
          fields: CubeField.Payload(
            "Signum meum nondum certum est, sed clavis mea semper eadem erit."),
          requiredDifficulty: reducedDifficulty
      });
      expect(muc.getKeyIfAvailable().equals(publicKey)).toBeTruthy();
      expect((await muc.getKey()).equals(publicKey)).toBeTruthy();
    })

    it('should present a valid hash for a MUC when hash is requested before binary data', async () => {
      await sodium.ready;
      const keyPair = sodium.crypto_sign_keypair();
      const publicKey: Buffer = Buffer.from(keyPair.publicKey);
      const privateKey: Buffer = Buffer.from(keyPair.privateKey);

      const muc: Cube = Cube.MUC(
        publicKey, privateKey, {
          fields: CubeField.Payload(
            "Gratiose tibi dabo signum meum etiamsi non intersit tibi de mea data binaria."),
          requiredDifficulty: reducedDifficulty
      });

      const hash: Buffer = await muc.getHash();
      const key: Buffer = await muc.getKey();
      const binaryCube = await muc.getBinaryData();

      expect(key).toEqual(publicKey);
      expect(hash).toEqual(calculateHash(binaryCube));
    }, 5000);
  });

  describe('method padUp()', () => {
    it('Should not add padding if not required', async() => {
      // Create a Cube with fields whose total length is equal to the cube size
      const cube = Cube.Frozen({fields: CubeField.Payload("His cubus plenus est")});
      const freeSpace = NetConstants.CUBE_SIZE - cube.fields.getByteLength();
      const plHl = cube.fieldParser.getFieldHeaderLength(CubeFieldType.PAYLOAD);
      cube.fields.insertFieldBeforeBackPositionals(CubeField.Payload(
        Buffer.alloc(freeSpace - plHl)));  // cube now all filled up
      expect(cube.fields.getByteLength()).toEqual(NetConstants.CUBE_SIZE);

      const fieldCountBeforePadding = cube.fields.all.length;
      const paddingAdded: boolean = cube.padUp();
      const fieldCountAfterPadding = cube.fields.all.length;

      expect(paddingAdded).toBe(false);
      expect(fieldCountAfterPadding).toEqual(fieldCountBeforePadding);
      expect(cube.fields.getByteLength()).toEqual(NetConstants.CUBE_SIZE);
    });

    it('Should add padding starting with 0x00 if required', async() => {
      // Create a Cube with fields whose total length is equal to the cube size
      const payload = CubeField.Payload(
        "Hic cubus nimis parvus, ideo supplendus est.");
      const cube = Cube.Frozen({fields: payload});

      const fieldCountBeforePadding = cube.fields.all.length;
      const paddingAdded = cube.padUp();
      const fieldCountAfterPadding = cube.fields.all.length;

      expect(paddingAdded).toBe(true);
      expect(fieldCountAfterPadding).toBeGreaterThan(fieldCountBeforePadding);
      expect(cube.fields.getByteLength()).toEqual(NetConstants.CUBE_SIZE);

      // now get binary data and ensure padding starts with 0x00
      const binaryCube: Buffer = await cube.getBinaryData();
      const expectEndMarkerAt =
        payload.start +
        cube.fieldParser.getFieldHeaderLength(CubeFieldType.PAYLOAD) +
        payload.length;
      expect(binaryCube[expectEndMarkerAt]).toEqual(0x00);
    });
  });  // describe padUp()
});
