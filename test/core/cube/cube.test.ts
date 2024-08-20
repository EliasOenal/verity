// cube.test.ts
import { NetConstants } from '../../../src/core/networking/networkDefinitions';

import { enumNums, unixtime } from '../../../src/core/helpers/misc';
import { BaseField } from '../../../src/core/fields/baseField';
import { BaseFields } from '../../../src/core/fields/baseFields';
import { FieldParser } from '../../../src/core/fields/fieldParser';

import { BinaryLengthError, CubeFieldLength, CubeFieldType, CubeSignatureError, CubeType, FieldSizeError, HasNotify, HasSignature, RawcontentFieldType } from '../../../src/core/cube/cube.definitions';
import { Cube } from '../../../src/core/cube/cube';
import { calculateHash, countTrailingZeroBits, paddedBuffer, verifySignature } from '../../../src/core/cube/cubeUtil';
import { CubeField } from '../../../src/core/cube/cubeField';
import { CubeFields, CoreFrozenFieldDefinition, CoreMucFieldDefinition, CoreFieldParsers } from '../../../src/core/cube/cubeFields';
import { CubeInfo } from '../../../src/core/cube/cubeInfo';

import { Buffer } from 'buffer';
import sodium from 'libsodium-wrappers-sumo'

import pkg from 'js-sha3';  // strange standards compliant syntax for importing
const { sha3_256 } = pkg;   // commonJS modules as if they were ES6 modules


// TODO: Add more tests. This is one of our most crucial core classes and it's
// nowhere near fully covered.

describe('cube', () => {
  const reducedDifficulty = 0;

  // TODO: Update payload field ID. Make tests actually check payload.
  const validBinaryCube = Buffer.from([
    // Cube version (1) (half byte), Cube type (basic "frozen" Cube, 0) (half byte)
    0x10,

    // Payload TLV field
    0x04,  // CCI payload field type is 4 (1 byte)
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
    it('should construct a cube object from binary data.', () => {
      expect(() => validBinaryCube.length === 1024).toBeTruthy();
      const cube = new Cube(validBinaryCube);
      const fields = cube.fields.all;
      fields.forEach(field => {
        expect(field.length).toBeLessThanOrEqual(1024);
        expect(field.length).toBeGreaterThanOrEqual(0);
      }, 3000);

      expect(fields[0].type).toEqual(CubeFieldType.TYPE);
      expect(fields[1].type).toEqual(CubeFieldType.FROZEN_RAWCONTENT);
      expect(fields[2].type).toEqual(CubeFieldType.DATE);

      expect(fields[3].type).toEqual(CubeFieldType.NONCE);
      expect(fields[3].length).toEqual(4);
      expect(fields[3].value).toEqual(Buffer.from([0x00, 0x00, 0x00, 0xed]));
    }, 3000);

    it('construct a Cube object with no fields by default', () => {
      const cube = new Cube(CubeType.FROZEN);
      expect(cube.fields.all.length).toEqual(0);
    }, 3000);

    it('should throw an error when binary data is not the correct length', () => {
      expect(() => new Cube(Buffer.alloc(512))).toThrow(BinaryLengthError);  // too short
      expect(() => new Cube(Buffer.alloc(578232))).toThrow(BinaryLengthError);  // too long
    }, 3000);

    // TODO: move this test to CCI or get rid of it
    // In the current core architecture it's completely useless as all
    // fields are mandatory, all fields are fixed size and therefore a Cube
    // is always maximum size.
    it('should accept maximum size cubes', async () => {
      const cube = Cube.Frozen({
        fields: CubeField.RawContent(CubeType.FROZEN,
          "Hic Cubus maximae magnitudinis est"),
        requiredDifficulty: reducedDifficulty
      });
      const binaryData = await cube.getBinaryData();
      expect(binaryData.length).toEqual(1024);
    }, 3000);
  });  // construction


  describe('setters and getters', () => {
    it('should set and get fields correctly', () => {
      const cube = new Cube(CubeType.FROZEN);
      const fields = new CubeFields([
        CubeField.Type(CubeType.FROZEN),
        CubeField.RawContent(CubeType.FROZEN,
          "Ero celeber Cubus cum compilatus fuero."),
        CubeField.Date(),
        CubeField.Nonce(),
      ], CoreFrozenFieldDefinition);
      cube.setFields(fields);
      expect(cube.fields).toEqual(fields);
      expect(cube.fields.getFirst(CubeFieldType.FROZEN_RAWCONTENT).valueString).toContain(
        "Ero celeber Cubus cum compilatus fuero.");
    }, 3000);

    it.skip('should throw an error when there is not enough space for a field value', () => {
      // Cannot sensibly be tested on the core layer as there's no TLV;
      // everything is fixed size anyway and will throw way before setFields()
      // if sizes don't match.
      // TODO: Move to CCI tests
      const cube = new Cube(CubeType.FROZEN);
      const fields = new CubeFields([
        CubeField.Type(CubeType.FROZEN),
        new CubeField(CubeFieldType.FROZEN_RAWCONTENT, Buffer.alloc(8020)),
        CubeField.Date(),
        CubeField.Nonce()
      ], CoreFrozenFieldDefinition); // Too long for the binary data
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
      const cube = Cube.Frozen({ fields: CubeField.RawContent(CubeType.FROZEN, "hello Cube") });
      expect(cube.fields.all[0].type).toEqual(CubeFieldType.TYPE);
      expect(cube.fields.all[1].type).toEqual(CubeFieldType.FROZEN_RAWCONTENT);
      expect(cube.fields.all[2].type).toEqual(CubeFieldType.DATE);
      expect(cube.fields.all[3].type).toEqual(CubeFieldType.NONCE);
    }, 3000);
  });  // static methods


  describe('basic compilation', () => {
    it('should compile fields correctly even after manipulating them', async () => {
      const cube = Cube.Frozen({
        fields: CubeField.RawContent(CubeType.FROZEN, " "),
        requiredDifficulty: reducedDifficulty
      });
      cube.fields.getFirst(CubeFieldType.FROZEN_RAWCONTENT).value.write(
        'Ego sum determinavit tarde quid dicere Cubus.', 'ascii');
      const binaryData = await cube.getBinaryData();
      expect(binaryData[0]).toEqual(CubeType.FROZEN);
      const parser = new FieldParser(CoreFrozenFieldDefinition);  // decompileTlv is true
      const recontructed: BaseFields = parser.decompileFields(binaryData);
      const reconstructed_payload: BaseField = recontructed.getFirst(CubeFieldType.FROZEN_RAWCONTENT);
      expect(reconstructed_payload.valueString).toContain(
        'Ego sum determinavit tarde quid dicere Cubus.');
    }, 3000);

    it('should recompile fields correctly after manipulating them', async () => {
      // sculpt Cube
      const cube = Cube.Frozen({
        fields: CubeField.RawContent(CubeType.FROZEN, "Cubus sum"),
        requiredDifficulty: reducedDifficulty
      });
      await cube.compile();
      // test reactivation of first Cube version
      {
        const binaryData = cube.getBinaryDataIfAvailable();  // available as we just compiled
        expect(binaryData[0]).toEqual(CubeType.FROZEN);
        const parser = new FieldParser(CoreFrozenFieldDefinition);  // decompileTlv is true
        const recontructed: BaseFields = parser.decompileFields(binaryData);
        expect(recontructed.getFirst(CubeFieldType.FROZEN_RAWCONTENT).valueString).
          toContain("Cubus sum");
      }
      // manipulate & recompile Cube
      cube.fields.getFirst(CubeFieldType.FROZEN_RAWCONTENT).value.write(
        'Determinavit tarde quid dicere Cubus sum', 'ascii');
      await cube.compile();
      // test reactivation of first Cube version
      {
        const binaryData = cube.getBinaryDataIfAvailable();  // available as we just compiled
        expect(binaryData[0]).toEqual(CubeType.FROZEN);
        const parser = new FieldParser(CoreFrozenFieldDefinition);  // decompileTlv is true
        const recontructed: BaseFields = parser.decompileFields(binaryData);
        expect(recontructed.getFirst(CubeFieldType.FROZEN_RAWCONTENT).valueString).
          toContain("Determinavit tarde quid dicere Cubus sum");
      }
    });
  });

  describe('hashing', () => {
    it('should calculate the hash correctly', async () => {
      const cube = Cube.Frozen({
        fields: CubeField.RawContent(CubeType.FROZEN, "Quaeso computa digestum meum"),
        requiredDifficulty: reducedDifficulty
      });
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
        fields: CubeField.RawContent(CubeType.FROZEN, 'Exigo requisitum provocationis')
      });
      const key: Buffer = await cube.getKey();
      expect(key[key.length - 1]).toEqual(0);  // == min 8 bits difficulty
    }, 5000);
  });

  describe('tests by Cube type', () => {
    describe('compilation and decompilation by Cube type', () => {
      enumNums(CubeType).forEach((type) => {  // perform the tests for every CubeType
        it(`should compile and decompile ${CubeType[type]} Cubes correctly`, async () => {
          // Craft a randomized content string. We will later test if it's
          // still correct after compiling and decompiling.
          const randomNumer = Math.floor(Math.random() * 100000);
          const contentString = `Cubus generis ${CubeType[type]} sum. Numerus fortuitus meus est ${randomNumer}.`;
          const randomNotifyNumer = Math.floor(Math.random() * 255);

          // Set up our custom Cube content:
          // One raw content field...
          const incompleteFieldset: CubeField[] =
            [CubeField.RawContent(type, contentString)];
          // ... plus a Notify field if this is a Notify type ...
          if (HasNotify[type]) incompleteFieldset.push(
            CubeField.Notify(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, randomNotifyNumer)));
          // ... plus a public key field if this is a signed type.
          let publicKey: Buffer, privateKey: Buffer;
          if (HasSignature[type]) {
            await sodium.ready;
            const keyPair = sodium.crypto_sign_keypair();
            publicKey = Buffer.from(keyPair.publicKey);
            privateKey = Buffer.from(keyPair.privateKey);
            incompleteFieldset.push(CubeField.PublicKey(publicKey));
          }

          // auto-complete the fieldset with the required positional fields
          const fields: CubeFields = CubeFields.DefaultPositionals(
            CoreFieldParsers[type].fieldDef, incompleteFieldset);
          // sculpt Cube
          const cube: Cube = new Cube(type, {
            fields: fields,
            requiredDifficulty: reducedDifficulty,
          });
          // if this is a signed Cube type, supply the private key
          if (HasSignature[type]) cube.privateKey = privateKey;
          // compile Cube
          const binaryData = await cube.getBinaryData();
          // verify hash calculation is correct (has is always calculated from
          // the entire binary data, even though key generation differs by Cube type)
          const expectedHash: Buffer = Buffer.from(sha3_256.arrayBuffer(binaryData));
          expect(await cube.getHash()).toEqual(expectedHash);
          // verify key calculation is correct
          const key = await cube.getKey();
          // for signed Cubes, the key is the public key
          if (HasSignature[type]) expect(key).toEqual(publicKey);
          else if (type === CubeType.FROZEN || type === CubeType.FROZEN_NOTIFY) {
            // for frozen Cubes, the key is the full hash
            expect(key).toEqual(expectedHash);
          } else if (type === CubeType.PIC || type === CubeType.PIC_NOTIFY) {
            // for PICs, the key is the hash excluding the DATE and NONCE fields
            const keyHashLength =
              CubeFieldLength[CubeFieldType.TYPE] +
              CubeFieldLength[CubeFieldType.PIC_RAWCONTENT];  // equal to the lengths of PIC_NOTIFY_RAWCONTENT plus NOTIFY
            const keyHashableBinaryData = binaryData.subarray(0, keyHashLength);
            const expectedKey = Buffer.from(sha3_256.arrayBuffer(keyHashableBinaryData));
            expect(key).toEqual(expectedKey);
          }

          // decompile the Cube and check if the content is still the same
          const recontructed: Cube = new Cube(binaryData);
          expect(recontructed.cubeType).toBe(type);
          expect(recontructed.fields.getFirst(RawcontentFieldType[type]).value).
            toEqual(paddedBuffer(
              contentString, CubeFieldLength[RawcontentFieldType[type]]));
          if (HasNotify[type]) {
            expect(recontructed.fields.getFirst(CubeFieldType.NOTIFY).value[0]).toEqual(randomNotifyNumer);
          }
          // double-check hash is still correct
          expect(await recontructed.getHash()).toEqual(expectedHash);
        }, 3000);
      });  // for each Cube type
    });  // basic compilation and decompilation by Cube type

    describe('MUC tests', () => {
      it('should compile and decompile correctly', async () => {
        // Generate a key pair for testing
        await sodium.ready;
        const keyPair = sodium.crypto_sign_keypair();
        const publicKey: Buffer = Buffer.from(keyPair.publicKey);
        const privateKey: Buffer = Buffer.from(keyPair.privateKey);

        const muc = Cube.MUC(
          publicKey, privateKey, {
          fields: CubeField.RawContent(CubeType.MUC,
            "Ego sum cubus usoris mutabilis."),
          requiredDifficulty: reducedDifficulty
        });
        await muc.compile();
        const binaryData = muc.getBinaryDataIfAvailable();
        const parser = new FieldParser(CoreMucFieldDefinition);  // decompileTlv is true
        const recontructed: BaseFields = parser.decompileFields(binaryData);
        expect(recontructed.getFirst(CubeFieldType.MUC_RAWCONTENT).valueString).
          toContain("Ego sum cubus usoris mutabilis.");
      }, 3000);

      it('should correctly generate and validate MUC with manually specified fields', async () => {
        // Generate a key pair for testing
        await sodium.ready;
        const keyPair = sodium.crypto_sign_keypair();
        const publicKey: Buffer = Buffer.from(keyPair.publicKey);
        const privateKey: Buffer = Buffer.from(keyPair.privateKey);

        // Create a new MUC with specified TLV fields
        const muc = new Cube(CubeType.MUC, { requiredDifficulty: reducedDifficulty });
        muc.privateKey = privateKey;

        const fields = new CubeFields([
          CubeField.Type(CubeType.MUC),
          CubeField.RawContent(CubeType.MUC, "Ego sum cubus usoris mutabilis."),
          CubeField.PublicKey(publicKey),
          CubeField.Date(),
          CubeField.Signature(Buffer.alloc(NetConstants.SIGNATURE_SIZE)),
          CubeField.Nonce(),
        ], CoreMucFieldDefinition);

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

      it('should correctly sign a MUC', async () => {
        // Generate a key pair for testing
        await sodium.ready;
        const keyPair = sodium.crypto_sign_keypair();
        const publicKey: Buffer = Buffer.from(keyPair.publicKey);
        const privateKey: Buffer = Buffer.from(keyPair.privateKey);

        const muc = Cube.MUC(
          publicKey, privateKey, {
          fields: CubeField.RawContent(CubeType.MUC,
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

      it('should correctly parse MUC from binary', async () => {
        // Generate a key pair for testing
        await sodium.ready;
        const keyPair = sodium.crypto_sign_keypair();
        const publicKey: Buffer = Buffer.from(keyPair.publicKey);
        const privateKey: Buffer = Buffer.from(keyPair.privateKey);

        // Create a new MUC with a random payload
        const muc = Cube.MUC(publicKey, privateKey, {
          fields: CubeField.RawContent(CubeType.MUC,
            "Ego sum cubus usoris mutabilis, peculiare informatiuncula quae a domino meo corrigi potest."),
          requiredDifficulty: reducedDifficulty
        });
        const key = await muc.getKey();
        expect(key).toBeInstanceOf(Buffer);

        const binMuc: Buffer = await muc.getBinaryData();
        expect(binMuc).toBeInstanceOf(Buffer);

        const coreParsedMuc = new Cube(binMuc);
        expect(coreParsedMuc).toBeInstanceOf(Cube);
        expect(coreParsedMuc.fields.all.length).toEqual(6);
        expect(coreParsedMuc.fields.all[0].type).toEqual(CubeFieldType.TYPE);
        expect(coreParsedMuc.fields.all[1].type).toEqual(CubeFieldType.MUC_RAWCONTENT);
        expect(coreParsedMuc.fields.all[2].type).toEqual(CubeFieldType.PUBLIC_KEY);
        expect(coreParsedMuc.fields.all[3].type).toEqual(CubeFieldType.DATE);
        expect(coreParsedMuc.fields.all[4].type).toEqual(CubeFieldType.SIGNATURE);
        expect(coreParsedMuc.fields.all[5].type).toEqual(CubeFieldType.NONCE);
        expect(coreParsedMuc.publicKey.equals(publicKey)).toBeTruthy();
        expect(coreParsedMuc.fields.getFirst(CubeFieldType.DATE).value.equals(
          muc.fields.getFirst(CubeFieldType.DATE).value)).toBeTruthy();

        expect(coreParsedMuc.fields.getFirst(CubeFieldType.MUC_RAWCONTENT).valueString).toContain(
          "Ego sum cubus usoris mutabilis, peculiare informatiuncula quae a domino meo corrigi potest.");
      }, 5000);

      it('should reject a binary MUC with invalid signature', async () => {
        // Generate a key pair for testing
        await sodium.ready;
        const keyPair = sodium.crypto_sign_keypair();
        const publicKey: Buffer = Buffer.from(keyPair.publicKey);
        const privateKey: Buffer = Buffer.from(keyPair.privateKey);

        // Sculpt MUC
        const muc = Cube.MUC(
          publicKey, privateKey, {
          fields: CubeField.RawContent(CubeType.MUC,
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
          fields: CubeField.RawContent(CubeType.MUC,
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
          fields: CubeField.RawContent(CubeType.MUC,
            "Gratiose tibi dabo signum meum etiamsi non intersit tibi de mea data binaria."),
          requiredDifficulty: reducedDifficulty
        });

        const hash: Buffer = await muc.getHash();
        const key: Buffer = await muc.getKey();
        const binaryCube = await muc.getBinaryData();

        expect(key).toEqual(publicKey);
        expect(hash).toEqual(calculateHash(binaryCube));
      }, 5000);
    });  // MUC tests
  });  // test by Cube type

  describe('consistency tests', () => {
    test('a MUC should remain valid after updating its date', async () => {
      // prepare cryptographic keys
      await sodium.ready;
      const keyPair = sodium.crypto_sign_keypair();
      const publicKey: Buffer = Buffer.from(keyPair.publicKey);
      const privateKey: Buffer = Buffer.from(keyPair.privateKey);

      // sculpts a MUC
      const muc: Cube = Cube.MUC(
        publicKey, privateKey, {
        fields: [
          CubeField.RawContent(CubeType.MUC,
            "Melita res publica facta est"),
          CubeField.Date(156164400),  // republic day
          ],
        requiredDifficulty: reducedDifficulty,
      });

      // verify its signature is valid
      let binary = await muc.getBinaryData();
      expect(muc.verifySignature()).toBe(true);

      // update date (this operation is properly encapsulated)
      muc.setDate(291726000);  // freedom day

      // verify its signature is still valid
      binary = await muc.getBinaryData();
      expect(muc.verifySignature()).toBe(true);
    });

    // This test currently FAILS because a Cube's fields are not properly
    // encapsulated and thus user code can easily manipulate fields without
    // the Cube object noticing.
    test.skip('a MUC should remain valid after updating its content', async () => {
      // prepare cryptographic keys
      await sodium.ready;
      const keyPair = sodium.crypto_sign_keypair();
      const publicKey: Buffer = Buffer.from(keyPair.publicKey);
      const privateKey: Buffer = Buffer.from(keyPair.privateKey);

      // sculpts a MUC
      const muc: Cube = Cube.MUC(
        publicKey, privateKey, {
        fields: [
          CubeField.RawContent(CubeType.MUC,
            "Melita res publica facta est"),
          CubeField.Date(156164400),  // republic day
          ],
        requiredDifficulty: reducedDifficulty,
      });

      // verify its signature is valid
      let binary = await muc.getBinaryData();
      expect(muc.verifySignature()).toBe(true);

      // update content
      muc.fields.getFirst(CubeFieldType.MUC_RAWCONTENT).value.write(
        "Sed militia Britannica adhuc in Melita stat", 'ascii');

      // verify its signature is still valid
      binary = await muc.getBinaryData();
      expect(muc.verifySignature()).toBe(true);
    });
  })
});
