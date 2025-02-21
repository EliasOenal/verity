import { cciCube, cciFamily } from "../../../src/cci/cube/cciCube";
import { MediaTypes, FieldType } from "../../../src/cci/cube/cciCube.definitions";
import { VerityField } from "../../../src/cci/cube/verityField";
import { Continuation } from "../../../src/cci/veritum/continuation";
import { Veritum, VeritumFromChunksOptions } from "../../../src/cci/veritum/veritum";
import { coreCubeFamily } from "../../../src/core/cube/cube";
import { CubeKey, CubeType, HasNotify, HasSignature } from "../../../src/core/cube/cube.definitions";
import { NetConstants } from "../../../src/core/networking/networkDefinitions";
import { enumNums } from "../../../src/core/helpers/misc";

import { evenLonger, tooLong } from "../testcci.definitions";
import { Relationship, RelationshipType } from "../../../src/cci/cube/relationship";

import sodium from 'libsodium-wrappers-sumo'
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

const requiredDifficulty = 0;

describe('Veritum', () => {
  const applicationField = VerityField.Application("contentum probationis non applicationis");
  const mediaTypeField = VerityField.MediaType(MediaTypes.TEXT);
  const payloadField = VerityField.Payload("Hoc veritum probatio est");

  let publicKey: Buffer;
  let privateKey: Buffer;

  let encryptionPublicKey: Buffer;
  let encryptionPrivateKey: Buffer;

  beforeAll(async () => {
    await sodium.ready;
    const keyPair = sodium.crypto_sign_keypair()
    publicKey = Buffer.from(keyPair.publicKey);
    privateKey = Buffer.from(keyPair.privateKey);
    const encryptionKeyPair = sodium.crypto_box_keypair();
    encryptionPublicKey = Buffer.from(encryptionKeyPair.publicKey);
    encryptionPrivateKey = Buffer.from(encryptionKeyPair.privateKey);
  });

  describe('construction', () => {
    describe('FromChunks()', () => {
      for (const chunkNo of [1, 2, 3]) {
        for (const cubeType of enumNums(CubeType)) {

          // TODO BUGBUG FIXME multi-chunk signed Verita still don't work
          if (HasSignature[cubeType] && chunkNo > 1) continue;

          for (const encrypt of [true, false]) for (const supplyKey of [true, false]) {
            const readable: boolean = !encrypt || (encrypt && supplyKey);

            let describeText: string = "this should never display or there's a bug in the test setup";
            if (!encrypt && !supplyKey) describeText = "reconstructing plaintext Verita";
            if (!encrypt && supplyKey) describeText = "reconstructing plaintext Verita, supplying a spurious decryption key";
            if (encrypt && !supplyKey) describeText = "trying to reconstruct encrypted Verita without a decryption key";
            if (encrypt && supplyKey) describeText = "reconstructing encrypted Verita";
            describe(describeText, () => {

              describe(`${chunkNo}-chunk ${CubeType[cubeType]} Veritum`, () => {
                let text: string;
                let veritum: Veritum;
                let veritumKey: CubeKey;
                let veritumFields: VerityField[];
                let veritumChunks: cciCube[];

                const notify = VerityField.Notify(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x42));

                let reconstructed: Veritum;

                beforeAll(async () => {
                  // prepare fields
                  if (!encrypt && !supplyKey) text = `Haec veritum ${chunkNo} ${chunkNo == 1? 'segmentum' : 'segmenta'} generis ${CubeType[cubeType]} non est encryptum.`
                  if (!encrypt && supplyKey) text = `Haec veritum ${chunkNo} ${chunkNo == 1? 'segmentum' : 'segmenta'} generis ${CubeType[cubeType]} non est encryptum et non curabit de clavem superfluum.`
                  if (encrypt && !supplyKey) text = `Haec veritum ${chunkNo} ${chunkNo == 1? 'segmentum' : 'segmenta'} generis ${CubeType[cubeType]} decryptari non potest.`
                  if (encrypt && supplyKey) text = `Haec veritum ${chunkNo} ${chunkNo == 1? 'segmentum' : 'segmenta'} generis ${CubeType[cubeType]} decryptabitur.`
                  const payload = VerityField.Payload(text);

                  // sculpt test Veritum
                  veritum = new Veritum({
                    cubeType: cubeType,
                    fields: HasNotify[cubeType] ? [payload, notify] : [payload],
                    publicKey, privateKey, requiredDifficulty: 0,
                  });

                  // grow Veritum to the desired number of chunks
                  while (veritum.getFieldLength() < (chunkNo -1) * NetConstants.CUBE_SIZE) {
                    veritum.insertFieldBeforeBackPositionals(payload);
                  }
                  expect(veritum.getFieldLength() >= (chunkNo - 1) * NetConstants.CUBE_SIZE).toBeTruthy();
                  expect(veritum.getFieldLength() < chunkNo * NetConstants.CUBE_SIZE).toBeTruthy();

                  // compile Veritum and remember key
                  await veritum.compile({
                    recipients: encrypt? encryptionPublicKey : undefined,
                  });
                  veritumKey = veritum.getKeyIfAvailable();
                  expect(veritumKey.length).toBe(NetConstants.CUBE_KEY_SIZE);

                  // keep a copy of the Veritum's fields and chunks before running the test
                  veritumFields = [];
                  for (const field of veritum.getFields()) {
                    veritumFields.push(new VerityField(field));
                  }
                  veritumChunks = [];
                  for (const chunk of veritum.chunks) {
                    veritumChunks.push(new cciCube(chunk));
                  }

                  // verify test setup:
                  // - if encrypted, assert the compiled chunks contain no plaintext
                  // - if not encrypted, assert the compiled chunks do contain plaintext
                  if (encrypt) {
                    for (const chunk of veritum.chunks) {
                      expect(chunk.getFirstField(FieldType.PAYLOAD)).toBeUndefined();
                      expect(chunk.getBinaryDataIfAvailable()).toBeInstanceOf(Buffer);
                      expect(chunk.getBinaryDataIfAvailable().toString('utf-8')).not.toContain('Haec veritum');
                    }
                  } else {
                    for (const chunk of veritum.chunks) {
                      expect(chunk.getFirstField(FieldType.PAYLOAD)).toBeDefined();
                    }
                  }

                  // Run test.
                  // We will be extra mean and still pass a decryption private key
                  // even though there is nothing to decrypt.
                  let options: VeritumFromChunksOptions;
                  if (supplyKey) {
                    options = { recipientPrivateKey: encryptionPrivateKey };
                  } else {
                    options = {};
                  }
                  reconstructed = Veritum.FromChunks(veritum.chunks, options);
                });  // beforeAll


                it('does not change the original Veritum or its chunks', () => {
                  expect(veritum.getKeyIfAvailable()).toEqual(veritumKey);

                  const fieldsAfter: VerityField[] = Array.from(veritum.getFields());
                  expect(fieldsAfter.length).toBe(veritumFields.length);
                  for (let i = 0; i < veritumFields.length; i++) {
                    expect(fieldsAfter[i]).not.toBe(veritumFields[i]);
                    expect(fieldsAfter[i].equals(veritumFields[i])).toBeTruthy();
                  }

                  const chunksAfter: cciCube[] = Array.from(veritum.chunks);
                  expect(chunksAfter.length).toBe(veritumChunks.length);
                  for (let i = 0; i < veritumChunks.length; i++) {
                    expect(chunksAfter[i]).not.toBe(veritumChunks[i]);
                    expect(chunksAfter[i].equals(veritumChunks[i])).toBeTruthy();
                  }

                  if (HasSignature[cubeType]) {
                    expect(reconstructed.publicKey).toBeInstanceOf(Buffer);
                    expect(reconstructed.publicKey).not.toBe(publicKey);
                    expect(reconstructed.publicKey).toEqual(publicKey);
                  }
                });

                it("the reconstructed Veritum should have the original Veritum's key", () => {
                  expect(reconstructed.getKeyIfAvailable()).toBeInstanceOf(Buffer);
                  expect(reconstructed.getKeyIfAvailable()).toEqual(veritumKey);
                });

                if (readable) it("should have reconstructed the original Veritum's payload", () => {
                  expect(reconstructed.getFirstField(FieldType.PAYLOAD).valueString).toEqual(text);
                });
                else it("cannot reconstruct the original Veritum's payload", () => {
                  expect(reconstructed.getFirstField(FieldType.PAYLOAD)).toBeUndefined();
                });


                if (HasSignature[cubeType]) it('will adopt the first chunk\'s public key', () => {
                  expect(reconstructed.publicKey).toBeInstanceOf(Buffer);
                  expect(reconstructed.publicKey).toEqual(veritum.chunks[0].publicKey);
                });

                if (HasNotify[cubeType]) it.todo("will adopt the first chunk's notification");
                it.todo("will adopt the first chunk's date field by default");
                if (cubeType === CubeType.PMUC || cubeType === CubeType.PMUC_NOTIFY) it.todo("will adopt the first chunk's update count if it is a PMUC");
              });  // feeding an unencrypted Veritum
            });  // supplying / not supplying a decryption key
          }  // for encrypt & supplyKey of [true, false]
        }
      }
    });

    describe('copy constructor', () => {
      it('copies all properties with default options', () => {
        const originalVeritum = new Veritum({cubeType: CubeType.FROZEN});
        const copiedVeritum = new Veritum(originalVeritum);

        expect(copiedVeritum.cubeType).toBe(originalVeritum.cubeType);
        expect(copiedVeritum.family).toBe(originalVeritum.family);
        expect(copiedVeritum.fieldParser).toBe(originalVeritum.fieldParser);
        expect(copiedVeritum.publicKey).toBe(originalVeritum.publicKey);
        expect(copiedVeritum.privateKey).toBe(originalVeritum.privateKey);
        expect(copiedVeritum.requiredDifficulty).toBe(originalVeritum.requiredDifficulty);
      });

      it('copies all fields from the original instance', () => {
        const originalVeritum = new Veritum({
          cubeType: CubeType.FROZEN,
          fields: [applicationField, mediaTypeField, payloadField],
        });
        const copiedVeritum = new Veritum(originalVeritum);

        expect(copiedVeritum.fieldsEqual(originalVeritum)).toBe(true);
      });

      it('creates a copy that evaluates as equal to the original', () => {
        const originalVeritum = new Veritum({
          cubeType: CubeType.FROZEN,
          fields: [applicationField, mediaTypeField, payloadField],
        });
        const copiedVeritum = new Veritum(originalVeritum);
        expect(copiedVeritum.equals(originalVeritum)).toBe(true);
      });

      it('ensures the copied instance is independent of the original', () => {
        const originalVeritum = new Veritum({
          cubeType: CubeType.FROZEN,
          fields: [applicationField, mediaTypeField, payloadField],
        });
        const copiedVeritum = new Veritum(originalVeritum);

        // Modify the copied instance
        copiedVeritum.appendField(VerityField.ContentName("original had no name"));

        // Ensure the original instance remains unchanged
        expect(originalVeritum.fieldsEqual(copiedVeritum)).toBe(false);
        expect(copiedVeritum.getFirstField(FieldType.CONTENTNAME)).toBeDefined();
        expect(originalVeritum.getFirstField(FieldType.CONTENTNAME)).toBeUndefined();
      });
    });
  });

  describe('equals()', () => {
    it.todo('write sensible high level equality function');
  });

  describe('getters', () => {
    describe('cubeType getter', () => {
      it('returns the CubeType set on construction', () => {
        const veritum = new Veritum({cubeType: CubeType.PMUC_NOTIFY});
        expect(veritum.cubeType).toBe(CubeType.PMUC_NOTIFY);
      });
    });

    describe('family getter', () => {
      it('returns the family set on construction', () => {
        const veritum = new Veritum({ cubeType: CubeType.PIC, family: coreCubeFamily });
        expect(veritum.family).toBe(coreCubeFamily);
      });

      it('uses CCI family by default', () => {
        const veritum = new Veritum({ cubeType: CubeType.MUC });
        expect(veritum.family).toBe(cciFamily);
      });
    });

    describe('fieldParser getter', () => {
      it('returns the correct field parser for CCI PMUC Veritae', () => {
        const veritum = new Veritum({ cubeType: CubeType.PMUC });
        expect(veritum.fieldParser).toBe(cciFamily.parsers[CubeType.PMUC]);
      });
    });

    describe('key getters', () => {
      enumNums(CubeType).forEach((cubeType) => {
        [1, 2, 3].forEach((chunkNo) => {
          let payloadField: VerityField;
          if (chunkNo === 1) payloadField = VerityField.Payload("Cubus unicus sum");
          else if (chunkNo === 2) payloadField = VerityField.Payload(tooLong);
          else payloadField = VerityField.Payload(evenLonger);
          ['non-compiled', 'compiled', 'reactivated'].forEach((state) => {
            describe(`key getter tests for a ${state} ${chunkNo}-chunk ${CubeType[cubeType]} Veritum`, () => {
              let veritum: Veritum;
              let expectedKey: Buffer;

              beforeAll(async () => {
                // sculpt a new Veritum
                veritum = new Veritum({
                  cubeType: cubeType,
                  fields: payloadField,
                  publicKey, privateKey, requiredDifficulty,
                });
                // do some pre-test processing by state:
                // - if we are testing compiled Verita, obviously compile it
                // - if we are testing reactivated Verita, compile it and then
                //   reconstruct it from the binary chunks
                if (state === 'compiled') {
                  await veritum.compile();
                }
                if (state === 'reactivated') {
                  await veritum.compile();
                  // for the reactivated state test, we also want to check that
                  // the key does not change after reactivation, so let's take
                  // note of the key before we proceed
                  expectedKey = veritum.getKeyIfAvailable();
                  expect(expectedKey.length).toBe(NetConstants.CUBE_KEY_SIZE);
                  // collect binary chunks
                  const binaryChunks: Buffer[] = [];
                  for (const chunk of veritum.chunks) {
                    binaryChunks.push(await chunk.getBinaryData());
                  }
                  // reactivate the chunks
                  const reactivatedChunks: cciCube[] = [];
                  for (const binaryChunk of binaryChunks) {
                    const reactivatedChunk: cciCube = new cciCube(binaryChunk);
                    reactivatedChunks.push(reactivatedChunk);
                  }
                  // reconstruct the Veritum from the reactivated chunks
                  veritum = Veritum.FromChunks(reactivatedChunks);
                }
              });

              if (state !== 'reactivated') it(`getKeyIfAvailable() returns ${HasSignature[cubeType] ? 'the public key' : 'undefined'} for a ${state} ${chunkNo}-chunk ${CubeType[cubeType]} Veritum`, async () => {
                // Perform test. The expected result varies based on CubeType.
                if (HasSignature[cubeType]) {
                  // For signed types, the key is always available, and always
                  // the public key.
                  expect(veritum.getKeyIfAvailable()).toBeInstanceOf(Buffer);
                  expect(veritum.getKeyIfAvailable()).toEqual(publicKey);
                  expect(veritum.getKeyStringIfAvailable()).toBeDefined();
                  expect(veritum.getKeyStringIfAvailable()).toEqual(publicKey.toString('hex'));
                } else {
                  // For non-signed Cubes the key is only available after compilation.
                  // Note that is is not guaranteed to be available after reactivation,
                  // as it may need to be recalculated.
                  if (state === 'reactivated') {
                    // We currently don't make any assertion on that.
                    // The long term goal would probably to skip any hash calculation
                    // on reactivation for performance, which would make the the
                    // return value undefined.
                    // Currently, we re-hash the whole Cube on reactivation making
                    // the key available for frozen Cubes, but don't recalculate the
                    // extra key hash for PICs.
                  } else if (state === 'compiled') {
                    expect(veritum.getKeyIfAvailable()).toBeInstanceOf(Buffer);
                    expect(veritum.getKeyIfAvailable()).toHaveLength(NetConstants.CUBE_KEY_SIZE);
                    expect(veritum.getKeyIfAvailable()).toEqual(
                      Array.from(veritum.chunks)[0].getKeyIfAvailable());
                    expect(veritum.getKeyStringIfAvailable()).toBeDefined();
                    expect(veritum.getKeyStringIfAvailable()).toHaveLength(NetConstants.CUBE_KEY_SIZE * 2);
                    expect(veritum.getKeyStringIfAvailable()).toEqual(
                      Array.from(veritum.chunks)[0].getKeyStringIfAvailable());
                  } else {
                    expect(veritum.getKeyIfAvailable()).toBeUndefined();
                    expect(veritum.getKeyStringIfAvailable()).toBeUndefined();
                  }
                }
              });  // test getKeyIfAvailabel()

              it(`getKey() returns the key for a ${state} ${chunkNo}-chunk ${CubeType[cubeType]} Veritum`, async () => {
                // Perform test.
                const result = await veritum.getKey();
                const resultString = await veritum.getKeyString();
                // The expected result varies based on CubeType.
                if (HasSignature[cubeType]) {
                  // For signed types, the key is always the public key.
                  expect(result).toBeInstanceOf(Buffer);
                  expect(result).toEqual(publicKey);
                  expect(resultString).toBeDefined();
                  expect(resultString).toEqual(publicKey.toString('hex'));
                } else {
                  // For non-signed Cubes the key is hash-based and equals
                  // the first chunk's key.
                  // Compilation is triggered automatically if needed.
                  expect(result).toBeInstanceOf(Buffer);
                  expect(result).toHaveLength(NetConstants.CUBE_KEY_SIZE);
                  const firstChunkKey: Buffer = await Array.from(veritum.chunks)[0].getKey();
                  expect(result).toEqual(firstChunkKey);
                  expect(resultString).toBeDefined();
                  expect(resultString).toHaveLength(NetConstants.CUBE_KEY_SIZE * 2);
                  expect(resultString).toEqual(firstChunkKey.toString('hex'));
                }
                // If this Verium was reactivation, compiling and reactivating
                // should not have changed the key
                if (state === 'reactivated') {
                  expect(result).toEqual(expectedKey);
                  expect(resultString).toEqual(expectedKey.toString('hex'));
                }
              });
            });  // key getter tests for a ${state} ${chunkNo}-chunk ${CubeType[cubeType]} Veritum
          });  // forEach non-compiled and compiled
        });  // forEach chunkNo
      });  // forEach CubeType
    });  // getKeyIfAvailable() and getKeyStringIfAvailable()
  });  // getters

  describe('compile()', () => {
    // Note: encryption tests are in encryption.test.ts

    describe('splitting', () => {
      it('compiles a short frozen Veritum to a single Frozen Cube', async() => {
        const veritum = new Veritum({
          cubeType: CubeType.FROZEN,fields: payloadField, requiredDifficulty});
        const cubesIterable: Iterable<cciCube> = await veritum.compile();
        expect(cubesIterable).toEqual(veritum.chunks);
        const compiled: cciCube[] = Array.from(cubesIterable);
        expect(compiled.length).toBe(1);
        expect(compiled[0].cubeType).toBe(CubeType.FROZEN);
        expect(compiled[0].getFirstField(FieldType.PAYLOAD).equals(payloadField)).toBeTruthy();
      });

      it('compiles a long frozen Veritum to multiple Frozen Cubes', async() => {
        const veritum = new Veritum({
          cubeType: CubeType.FROZEN, fields: VerityField.Payload(tooLong), requiredDifficulty});
        await veritum.compile({requiredDifficulty});
        expect(veritum.chunks).toHaveLength(2);

        // expect both chunks to contain a (partial) PAYLOAD field
        // and the first chunk to contain a reference to the second
        expect(veritum.chunks[0].getFirstField(FieldType.PAYLOAD)).toBeDefined();
        expect(veritum.chunks[1].getFirstField(FieldType.PAYLOAD)).toBeDefined();
        const refField: VerityField = veritum.chunks[0].getFirstField(FieldType.RELATES_TO);
        const ref = Relationship.fromField(refField);
        expect(ref.type).toEqual(RelationshipType.CONTINUED_IN);
        expect(ref.remoteKey).toBeInstanceOf(Buffer);
        expect(ref.remoteKey).toEqual(veritum.chunks[1].getKeyIfAvailable());

        const restored = Continuation.Recombine(veritum.chunks);
        expect(restored.cubeType).toBe(CubeType.FROZEN);
        expect(restored.getFirstField(FieldType.PAYLOAD).valueString).toEqual(
          tooLong);
      });

      it.todo('can split MUCs and PMUCs');
      it.todo('automatically sets and updates the PMUC update count');
      it.todo('will split a notification Veritum into a leading notification Cube followed by non-notification Cubes');  // write an e2e test for that, too!
      it.todo('will ensure all resulting chunks have the same date if not encrypted')
    });  // compile() splitting tests
  });  // compile()

  describe('field handling methods', () => {
    describe('field retrieval and analysis methods', () => {
      describe('fieldsEqual()', () => {
        it('returns true for two Veritum instances with the same fields', () => {
          const veritum1 = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, mediaTypeField, payloadField],
          });
          const veritum2 = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, mediaTypeField, payloadField],
          });
          expect(veritum1.fieldsEqual(veritum2)).toBe(true);
        });

        it('returns false for two Veritum instances with different fields', () => {
          const veritum1 = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, mediaTypeField, payloadField],
          });
          const veritum2 = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, mediaTypeField],
          });
          expect(veritum1.fieldsEqual(veritum2)).toBe(false);
        });

        it('returns false for two Veritum instances with different field values', () => {
          const differentPayloadField = VerityField.Payload("Different payload");
          const veritum1 = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, mediaTypeField, payloadField],
          });
          const veritum2 = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, mediaTypeField, differentPayloadField],
          });
          expect(veritum1.fieldsEqual(veritum2)).toBe(false);
        });

        it('returns true for two Veritum instances with empty fields', () => {
          const veritum1 = new Veritum({ cubeType: CubeType.FROZEN });
          const veritum2 = new Veritum({ cubeType: CubeType.FROZEN });
          expect(veritum1.fieldsEqual(veritum2)).toBe(true);
        });
      });

      describe('fieldCount()', () => {
        it('returns the correct number of fields', () => {
          const veritum = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, mediaTypeField, payloadField],
          });
          expect(veritum.fieldCount).toBe(3);
        });
      });

      describe('byteLength()', () => {
        it('returns the correct byte length for a single field', () => {
          const veritum = new Veritum(
            {cubeType: CubeType.FROZEN, fields: payloadField });
          const expectedByteLength =
            payloadField.value.length +
            veritum.fieldParser.getFieldHeaderLength(payloadField.type);
          expect(veritum.byteLength).toBe(expectedByteLength);
        });

        it('returns the correct byte length for multiple fields', () => {
          const veritum = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, mediaTypeField, payloadField],
          });
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
          const veritum = new Veritum({ cubeType: CubeType.FROZEN });
          expect(veritum.byteLength).toBe(0);
        });
      });

      describe('getFieldLength()', () => {
        it('returns the correct length for a single field', () => {
          const veritum = new Veritum({ cubeType: CubeType.FROZEN, fields: payloadField });
          const expectedLength = payloadField.value.length + veritum.fieldParser.getFieldHeaderLength(payloadField.type);
          expect(veritum.getFieldLength(payloadField)).toBe(expectedLength);
        });

        it('returns the correct length for multiple fields', () => {
          const veritum = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, mediaTypeField, payloadField],
          });
          const expectedApplicationLength: number =
            applicationField.value.length +
            veritum.fieldParser.getFieldHeaderLength(applicationField.type);
          const expectedMediaTypeLength: number =
            mediaTypeField.value.length +
            veritum.fieldParser.getFieldHeaderLength(mediaTypeField.type);
          const expectedPayloadLength: number =
            payloadField.value.length +
            veritum.fieldParser.getFieldHeaderLength(payloadField.type);
          const expectedTotalLength: number =
            expectedApplicationLength +
            expectedMediaTypeLength +
            expectedPayloadLength;

          expect(veritum.getFieldLength()).toBe(expectedTotalLength);
          expect(veritum.getFieldLength([applicationField])).toBe(
            expectedApplicationLength);
          expect(veritum.getFieldLength([applicationField, payloadField])).toBe(
            expectedApplicationLength + expectedPayloadLength);
          expect(veritum.getFieldLength([applicationField, payloadField, mediaTypeField])).toBe(
            expectedApplicationLength + expectedPayloadLength + expectedMediaTypeLength);
        });

        it('returns 0 for an empty field set', () => {
          const emptyVeritum = new Veritum({ cubeType: CubeType.FROZEN });
          expect(emptyVeritum.getFieldLength()).toBe(0);

          const nonEmptyVeritum = new Veritum({
            cubeType: CubeType.FROZEN, fields: payloadField });
          expect(emptyVeritum.getFieldLength([])).toBe(0);
        });

        it('can calculate the length even for fields not currently part of this Veritum', () => {
          const veritum = new Veritum({ cubeType: CubeType.PMUC });
          const expectedPayloadLength = payloadField.value.length + veritum.fieldParser.getFieldHeaderLength(payloadField.type);
          expect(veritum.getFieldLength(payloadField)).toBe(expectedPayloadLength);
        });
      });

      describe('getFields()', () => {
        it('fetches all fields by default', () => {
          const veritum = new Veritum({
            cubeType:CubeType.FROZEN,
            fields: [applicationField, mediaTypeField, payloadField],
          });
          const fields = Array.from(veritum.getFields());
          expect(fields.length).toBe(3);
          expect(fields[0]).toBe(applicationField);
          expect(fields[1]).toBe(mediaTypeField);
          expect(fields[2]).toBe(payloadField);
        });

        it('fetches a single field if there is only one of the specified type', () => {
          const veritum = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, mediaTypeField, payloadField],
          });
          const fields = Array.from(veritum.getFields(FieldType.PAYLOAD));
          expect(fields.length).toBe(1);
          expect(fields[0]).toBe(payloadField);
        });

        it.todo('fetches all fields of a specified type where multiple exist')
      });

      describe('getFirstField()', () => {
        it('returns the first field of the specified type', () => {
          const veritum = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, mediaTypeField, payloadField],
          });
          const field = veritum.getFirstField(FieldType.PAYLOAD);
          expect(field).toBe(payloadField);
        });

        it('returns undefined if no field of the specified type exists', () => {
          const veritum = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, mediaTypeField],
          });
          const field = veritum.getFirstField(FieldType.PAYLOAD);
          expect(field).toBeUndefined();
        });
      });

      describe('sliceFieldsBy()', () => {
        it.todo('splits the field set into blocks starting with a field of the specified type');
      });
    });  // field retrieval and analysis methods

    describe('field manipulation methods', () => {
      describe('appendField()', () => {
        it('appends a field to the Veritum', () => {
          const veritum = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, mediaTypeField],
          });
          veritum.appendField(payloadField);
          expect(veritum.fieldCount).toBe(3);
        });
      });

      describe('insertFieldInFront()', () => {
        it('inserts a field in front of the Veritum', () => {
          const veritum = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [mediaTypeField, payloadField],
          });
          veritum.insertFieldInFront(applicationField);
          expect(veritum.fieldCount).toBe(3);
          expect(veritum.getFields()[0]).toBe(applicationField);
        });
      });

      describe('insertFieldAfterFrontPositionals()', () => {
        it.todo('write tests');
      });

      describe('insertFieldBeforeBackPositionals()', () => {
        it.todo('write tests');
      });

      describe('insertFieldBefore()', () => {
        it('inserts a field before another field', () => {
          const veritum = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, payloadField],
          });
          veritum.insertFieldBefore(FieldType.PAYLOAD, mediaTypeField);
          expect(veritum.fieldCount).toBe(3);
          expect(veritum.getFields()[0].type).toBe(FieldType.APPLICATION);
          expect(veritum.getFields()[1].type).toBe(FieldType.MEDIA_TYPE);
          expect(veritum.getFields()[2].type).toBe(FieldType.PAYLOAD);
        });
      });

      describe('insertField()', () => {
        it.todo('write tests');
      });

      describe('ensureFieldInFront()', () => {
        it('adds a field in front if it does not exist', () => {
          const veritum = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [mediaTypeField, payloadField],
          });
          veritum.ensureFieldInFront(FieldType.APPLICATION, applicationField);
          expect(veritum.fieldCount).toBe(3);
          expect(veritum.getFields()[0]).toBe(applicationField);
        });

        it.todo('does nothing if a field of specified type is already in front');
      });

      describe('ensureFieldInBack()', () => {
        it('adds a field in back if it does not exist', () => {
          const veritum = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, mediaTypeField],
          });
          veritum.ensureFieldInBack(FieldType.PAYLOAD, payloadField);
          expect(veritum.fieldCount).toBe(3);
          expect(veritum.getFields()[2]).toBe(payloadField);
        });

        it.todo('does nothing if a field of specified type is already in back');
      });

      describe('removeField()', () => {
        it('removes a field from the Veritum by value', () => {
          const veritum = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, mediaTypeField, payloadField],
          });
          veritum.removeField(mediaTypeField);
          expect(veritum.fieldCount).toBe(2);
          expect(veritum.getFirstField(FieldType.MEDIA_TYPE)).toBeUndefined();
        });

        it('removes a field from the Veritum by index', () => {
          const veritum = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, mediaTypeField, payloadField],
          });
          veritum.removeField(1);
          expect(veritum.fieldCount).toBe(2);
          expect(veritum.getFirstField(FieldType.MEDIA_TYPE)).toBeUndefined();
        });
      });

      describe('manipulateFields()', () => {
        it.todo('returns an iterable containing all fields');
      });
    });  // field manipulation methods
  });  // field handling methods
});
