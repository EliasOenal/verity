import { cciCube, cciFamily } from "../../../src/cci/cube/cciCube";
import { MediaTypes, cciFieldType } from "../../../src/cci/cube/cciCube.definitions";
import { cciField } from "../../../src/cci/cube/cciField";
import { KeyPair } from "../../../src/cci/helpers/cryptography";
import { Veritum } from "../../../src/cci/veritum/veritum";
import { coreCubeFamily } from "../../../src/core/cube/cube";
import { CubeType } from "../../../src/core/cube/cube.definitions";
import { NetConstants } from "../../../src/core/networking/networkDefinitions";

import sodium from 'libsodium-wrappers-sumo'

const requiredDifficulty = 0;

describe('Veritum', () => {
  const applicationField = cciField.Application("contentum probationis non applicationis");
  const mediaTypeField = cciField.MediaType(MediaTypes.TEXT);
  const payloadField = cciField.Payload("Hoc veritum probatio est");

  let senderKeyPair: KeyPair;
  let recipientKeyPair: KeyPair;

  beforeAll(async () => {

    await sodium.ready;
    const uint8senderKeyPair = sodium.crypto_box_keypair();
    senderKeyPair = {
      publicKey: Buffer.from(uint8senderKeyPair.publicKey),
      privateKey: Buffer.from(uint8senderKeyPair.privateKey),
    };
    const uint8recipientKeyPair = sodium.crypto_box_keypair();
    recipientKeyPair = {
      publicKey: Buffer.from(uint8recipientKeyPair.publicKey),
      privateKey: Buffer.from(uint8recipientKeyPair.privateKey),
    };
  })

  describe('cubeType getter', () => {
    it('returns the CubeType set on construction', () => {
      const veritum = new Veritum(CubeType.PMUC_NOTIFY);
      expect(veritum.cubeType).toBe(CubeType.PMUC_NOTIFY);
    });
  });

  describe('family getter', () => {
    it('returns the family set on construction', () => {
      const veritum = new Veritum(CubeType.PIC, { family: coreCubeFamily });
      expect(veritum.family).toBe(coreCubeFamily);
    });

    it('uses CCI family by default', () => {
      const veritum = new Veritum(CubeType.MUC);
      expect(veritum.family).toBe(cciFamily);
    });
  });

  describe('fieldParser getter', () => {
    it('returns the correct field parser for CCI PMUC Veritae', () => {
      const veritum = new Veritum(CubeType.PMUC);
      expect(veritum.fieldParser).toBe(cciFamily.parsers[CubeType.PMUC]);
    });
  });

  describe('getKeyIfAvailable() and getKeyStringIfAvailable()', () => {
    it('returns undefined for a non-compiled frozen veritable', () => {
      const veritum = new Veritum(CubeType.FROZEN, {fields: payloadField});
      expect(veritum.getKeyIfAvailable()).toBeUndefined();
      expect(veritum.getKeyStringIfAvailable()).toBeUndefined();
    });

    it('returns the Cube key for a single-Cube compiled Veritum', async() => {
      const veritum = new Veritum(CubeType.FROZEN, {
        fields: payloadField, requiredDifficulty});
      await veritum.compile();
      expect(veritum.getKeyIfAvailable()).toBeInstanceOf(Buffer);
      expect(veritum.getKeyIfAvailable()).toEqual(
        Array.from(veritum.compiled)[0].getKeyIfAvailable());
    });

    it('returns the first Cube\'s key for a multi-Cube compiled Veritum', async () => {
      const largePayloadField = cciField.Payload(Buffer.alloc(NetConstants.CUBE_SIZE * 2, 'a'));
      const veritum = new Veritum(CubeType.FROZEN, {
        fields: largePayloadField, requiredDifficulty
      });

      const cubesIterable: Iterable<cciCube> = await veritum.compile();
      const compiled: cciCube[] = Array.from(cubesIterable);

      expect(compiled.length).toBeGreaterThan(1);
      const firstCubeKey = await compiled[0].getKey();
      expect(veritum.getKeyIfAvailable()).toEqual(firstCubeKey);
    });

    it('returns the public key for a MUC Veritum', () => {
      const publicKey = Buffer.alloc(NetConstants.PUBLIC_KEY_SIZE, 0x42);
      const veritum = new Veritum(CubeType.MUC, {fields: payloadField, publicKey});
      expect(veritum.getKeyIfAvailable()).toBe(publicKey);
      expect(veritum.getKeyStringIfAvailable()).toEqual(publicKey.toString('hex'));
    });
  });

  describe('encrypt()', () => {
    it('encrypts fields with default options', () => {
      const veritum = new Veritum(CubeType.FROZEN, { fields: payloadField });
      veritum.encrypt(senderKeyPair.privateKey, recipientKeyPair.publicKey);
      // there must now be an ENCRYPTED field
      expect(veritum.getFirstField(cciFieldType.ENCRYPTED)).toBeDefined();
      // there must no longer be a PAYLOAD field (as it's encrypted now)
      expect(veritum.getFirstField(cciFieldType.PAYLOAD)).toBeUndefined();
    });

    it('encrypts fields excluding specific fields', () => {
      const veritum = new Veritum(CubeType.FROZEN, { fields: [applicationField, payloadField] });
      veritum.encrypt(senderKeyPair.privateKey, recipientKeyPair.publicKey, { exclude: [cciFieldType.APPLICATION] });
      // expect the APPLICATION field to be kept
      expect(veritum.getFirstField(cciFieldType.APPLICATION)).toEqual(applicationField);
      // expect there to be an ENCRYPTED field
      expect(veritum.getFirstField(cciFieldType.ENCRYPTED)).toBeDefined();
      // expect encrypted fields not to contain any PAYLOAD field
      expect(veritum.getFirstField(cciFieldType.PAYLOAD)).toBeUndefined();
    });

    it('encrypts fields including sender public key', () => {
      const veritum = new Veritum(CubeType.FROZEN, { fields: payloadField });
      veritum.encrypt(senderKeyPair.privateKey, recipientKeyPair.publicKey,
        { includeSenderPubkey: senderKeyPair.publicKey });
      // expect there to be an ENCRYPTED field
      expect(veritum.getFirstField(cciFieldType.ENCRYPTED)).toBeDefined();
      // expect encrypted fields not to contain any PAYLOAD field
      expect(veritum.getFirstField(cciFieldType.PAYLOAD)).toBeUndefined();
      // expect there to be a CRYPTO_PUBKEY field
      expect(veritum.getFirstField(cciFieldType.CRYPTO_PUBKEY)).toBeDefined();
      expect(veritum.getFirstField(cciFieldType.CRYPTO_PUBKEY).value).toEqual(
        senderKeyPair.publicKey);
    });
  });

  describe('decrypt()', () => {
    it('decrypts a single PAYLOAD field', () => {
      const veritum = new Veritum(CubeType.FROZEN, { fields: payloadField });
      veritum.encrypt(senderKeyPair.privateKey, recipientKeyPair.publicKey);
      veritum.decrypt(recipientKeyPair.privateKey, senderKeyPair.publicKey);
      // there must now be a PAYLOAD field
      expect(veritum.getFirstField(cciFieldType.PAYLOAD)).toBeDefined();
      // there must no longer be an ENCRYPTED field (as it's decrypted now)
      expect(veritum.getFirstField(cciFieldType.ENCRYPTED)).toBeUndefined();
    });

    it('can use an included public key hint for decryption', () => {
      const veritum = new Veritum(CubeType.FROZEN, { fields: payloadField });
      veritum.encrypt(senderKeyPair.privateKey, recipientKeyPair.publicKey,
        { includeSenderPubkey: senderKeyPair.publicKey });
      veritum.decrypt(recipientKeyPair.privateKey);
      // there must now be a PAYLOAD field
      expect(veritum.getFirstField(cciFieldType.PAYLOAD)).toBeDefined();
      // there must no longer be an ENCRYPTED field (as it's decrypted now)
      expect(veritum.getFirstField(cciFieldType.ENCRYPTED)).toBeUndefined();
    });
  });

  describe('compile()', () => {
    it('compiles a short frozen Veritum to a single Frozen Cube', async() => {
      const veritum = new Veritum(CubeType.FROZEN, {
        fields: payloadField, requiredDifficulty});
      const cubesIterable: Iterable<cciCube> = await veritum.compile();
      expect(cubesIterable).toEqual(veritum.compiled);
      const compiled: cciCube[] = Array.from(cubesIterable);
      expect(compiled.length).toBe(1);
      expect(compiled[0].cubeType).toBe(CubeType.FROZEN);
      expect(compiled[0].getFirstField(cciFieldType.PAYLOAD)).toEqual(payloadField);
    });
  });

  describe('field handling methods', () => {
    describe('field retrieval and analysis methods', () => {
      describe('fieldsEqual()', () => {
        it('returns true for two Veritum instances with the same fields', () => {
          const veritum1 = new Veritum(CubeType.FROZEN, { fields: [applicationField, mediaTypeField, payloadField] });
          const veritum2 = new Veritum(CubeType.FROZEN, { fields: [applicationField, mediaTypeField, payloadField] });
          expect(veritum1.fieldsEqual(veritum2)).toBe(true);
        });

        it('returns false for two Veritum instances with different fields', () => {
          const veritum1 = new Veritum(CubeType.FROZEN, { fields: [applicationField, mediaTypeField, payloadField] });
          const veritum2 = new Veritum(CubeType.FROZEN, { fields: [applicationField, mediaTypeField] });
          expect(veritum1.fieldsEqual(veritum2)).toBe(false);
        });

        it('returns false for two Veritum instances with different field values', () => {
          const differentPayloadField = cciField.Payload("Different payload");
          const veritum1 = new Veritum(CubeType.FROZEN, { fields: [applicationField, mediaTypeField, payloadField] });
          const veritum2 = new Veritum(CubeType.FROZEN, { fields: [applicationField, mediaTypeField, differentPayloadField] });
          expect(veritum1.fieldsEqual(veritum2)).toBe(false);
        });

        it('returns true for two Veritum instances with empty fields', () => {
          const veritum1 = new Veritum(CubeType.FROZEN);
          const veritum2 = new Veritum(CubeType.FROZEN);
          expect(veritum1.fieldsEqual(veritum2)).toBe(true);
        });
      });

      describe('fieldCount()', () => {
        it('returns the correct number of fields', () => {
          const veritum = new Veritum(CubeType.FROZEN, {
            fields: [applicationField, mediaTypeField, payloadField],
          });
          expect(veritum.fieldCount).toBe(3);
        });
      });

      describe('byteLength()', () => {
        it('returns the correct byte length for a single field', () => {
          const veritum = new Veritum(CubeType.FROZEN, { fields: payloadField });
          const expectedByteLength =
            payloadField.value.length +
            veritum.fieldParser.getFieldHeaderLength(payloadField.type);
          expect(veritum.byteLength).toBe(expectedByteLength);
        });

        it('returns the correct byte length for multiple fields', () => {
          const veritum = new Veritum(CubeType.FROZEN, { fields: [applicationField, mediaTypeField, payloadField] });
          const expectedByteLength =
            applicationField.value.length +
            mediaTypeField.value.length +
            payloadField.value.length +
            veritum.fieldParser.getFieldHeaderLength(applicationField.type) +
            veritum.fieldParser.getFieldHeaderLength(mediaTypeField.type) +
            veritum.fieldParser.getFieldHeaderLength(payloadField.type);
          expect(veritum.byteLength).toBe(expectedByteLength);
        });

        it('returns 0 for an empty field set', () => {
          const veritum = new Veritum(CubeType.FROZEN);
          expect(veritum.byteLength).toBe(0);
        });
      });

      describe('getFieldLength()', () => {
        it('returns the correct length for a single field', () => {
          const veritum = new Veritum(CubeType.FROZEN, { fields: payloadField });
          const expectedLength = payloadField.value.length + veritum.fieldParser.getFieldHeaderLength(payloadField.type);
          expect(veritum.getFieldLength(payloadField)).toBe(expectedLength);
        });

        it('returns the correct length for multiple fields', () => {
          const veritum = new Veritum(CubeType.FROZEN, { fields: [applicationField, mediaTypeField, payloadField] });
          const expectedApplicationLength = applicationField.value.length + veritum.fieldParser.getFieldHeaderLength(applicationField.type);
          const expectedMediaTypeLength = mediaTypeField.value.length + veritum.fieldParser.getFieldHeaderLength(mediaTypeField.type);
          const expectedPayloadLength = payloadField.value.length + veritum.fieldParser.getFieldHeaderLength(payloadField.type);
          const expectedTotalLength = expectedApplicationLength + expectedMediaTypeLength + expectedPayloadLength;

          expect(veritum.getFieldLength()).toBe(expectedTotalLength);
          expect(veritum.getFieldLength([applicationField])).toBe(
            expectedApplicationLength);
          expect(veritum.getFieldLength([applicationField, payloadField])).toBe(
            expectedApplicationLength + expectedPayloadLength);
          expect(veritum.getFieldLength([applicationField, payloadField, mediaTypeField])).toBe(
            expectedApplicationLength + expectedPayloadLength + expectedMediaTypeLength);
        });

        it('returns 0 for an empty field set', () => {
          const emptyVeritum = new Veritum(CubeType.FROZEN);
          expect(emptyVeritum.getFieldLength()).toBe(0);

          const nonEmptyVeritum = new Veritum(CubeType.FROZEN, {fields: payloadField});
          expect(emptyVeritum.getFieldLength([])).toBe(0);
        });

        it('can calculate the length even for fields not currently part of this Veritum', () => {
          const veritum = new Veritum(CubeType.PMUC);
          const expectedPayloadLength = payloadField.value.length + veritum.fieldParser.getFieldHeaderLength(payloadField.type);
          expect(veritum.getFieldLength(payloadField)).toBe(expectedPayloadLength);
        });
      });

      describe('getFields()', () => {
        it('fetches all fields by default', () => {
          const veritum = new Veritum(CubeType.FROZEN, {
            fields: [applicationField, mediaTypeField, payloadField],
          });
          const fields = Array.from(veritum.getFields());
          expect(fields.length).toBe(3);
          expect(fields[0]).toBe(applicationField);
          expect(fields[1]).toBe(mediaTypeField);
          expect(fields[2]).toBe(payloadField);
        });

        it.todo('fetches all fields of the specified type');
      });

      describe('getFirstField()', () => {
        it.todo('write tests');
      });

      describe('sliceFieldsBy()', () => {
        it.todo('write tests');
      });
    });  // field retrieval and analysis methods

    describe('field manipulation methods', () => {
      describe('appendField()', () => {
        it.todo('write tests');
      });

      describe('insertFieldInFront()', () => {
        it.todo('write tests');
      });

      describe('insertFieldAfterFrontPositionals()', () => {
        it.todo('write tests');
      });

      describe('insertFieldBeforeBackPositionals()', () => {
        it.todo('write tests');
      });

      describe('insertFieldBefore()', () => {
        it.todo('write tests');
      });

      describe('insertField()', () => {
        it.todo('write tests');
      });

      describe('ensureFieldInFront()', () => {
        it.todo('write tests');
      });

      describe('ensureFieldInBack()', () => {
        it.todo('write tests');
      });

      describe('removeField()', () => {
        it.todo('write tests');
      });

      describe('manipulateFields()', () => {
        it.todo('write tests');
      });
    });  // field manipulation methods
  });  // field handling methods
});
