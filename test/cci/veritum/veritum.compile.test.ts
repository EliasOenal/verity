import { cciCube } from "../../../src/cci/cube/cciCube";
import { MediaTypes, FieldType } from "../../../src/cci/cube/cciCube.definitions";
import { VerityField } from "../../../src/cci/cube/verityField";
import { Recombine } from "../../../src/cci/veritum/continuation";
import { Veritum, VeritumFromChunksOptions } from "../../../src/cci/veritum/veritum";
import { CubeKey, CubeType, DEFAULT_CUBE_TYPE, HasNotify, HasSignature } from "../../../src/core/cube/cube.definitions";
import { NetConstants } from "../../../src/core/networking/networkDefinitions";
import { enumNums } from "../../../src/core/helpers/misc";

import { tooLong } from "../testcci.definitions";
import { Relationship, RelationshipType } from "../../../src/cci/cube/relationship";

import sodium from 'libsodium-wrappers-sumo'
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

const requiredDifficulty = 0;

describe('Veritum compilation/decompilation tests', () => {
  const applicationField = VerityField.Application("contentum probationis non applicationis");
  const mediaTypeField = VerityField.MediaType(MediaTypes.TEXT);
  const payloadField = VerityField.Payload("Hoc veritum probatio est");
  const notificationField = VerityField.Notify(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x69));

  let publicKey: Buffer;
  let privateKey: Buffer;

  let encryptionRecipientPublicKey: Buffer;
  let encryptionRecipientPrivateKey: Buffer;

  beforeAll(async () => {
    await sodium.ready;
    const keyPair = sodium.crypto_sign_keypair()
    publicKey = Buffer.from(keyPair.publicKey);
    privateKey = Buffer.from(keyPair.privateKey);
    const encryptionRecipientKeyPair = sodium.crypto_box_keypair();
    encryptionRecipientPublicKey = Buffer.from(encryptionRecipientKeyPair.publicKey);
    encryptionRecipientPrivateKey = Buffer.from(encryptionRecipientKeyPair.privateKey);
    const encryptionSenderKeyPair = sodium.crypto_box_keypair();
  });

  describe('compile()', () => {
    // Note: basic encryption tests are in veritumEncryption.test.ts --
    // this suite contains some higher level tests including encryption but
    // assumes the basics are working.

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

        const restored = Recombine(veritum.chunks);
        expect(restored.cubeType).toBe(CubeType.FROZEN);
        expect(restored.getFirstField(FieldType.PAYLOAD).valueString).toEqual(
          tooLong);
      });

      it.todo('can split MUCs and PMUCs');  // not currently implements, Github#634
      it.todo('automatically sets and updates the PMUC update count');  // not currently implements, Github#634
      it.todo('will split a notification Veritum into a leading notification Cube followed by non-notification Cubes');  // write an e2e test for that, too!
      it.todo('will ensure all resulting chunks have the same date if not encrypted')
    });  // compile() splitting tests

    describe('round-trip tests', () => {
      for (const chunkNo of [1, 2, 3]) {
        for (const cubeType of enumNums(CubeType)) {
          // multi-chunk signed Verita not implemented, see Github#634
          if (HasSignature[cubeType] && chunkNo > 1) continue;

          for (const encrypt of [true, false]) for (const supplyKey of [true, false]) {
            for (const roundTrips of [1, 2]) {
              if (encrypt && !supplyKey && roundTrips > 1) continue;  // cannot do extra round trip on unrestorable Veritum
              describe(`performing ${roundTrips === 1? 'a single round trip': roundTrips + ' round trips'}`, () => {
                const readable: boolean = !encrypt || (encrypt && supplyKey);

                let describeText: string = "this should never display or there's a bug in the test setup";
                if (!encrypt && !supplyKey) describeText = "reconstructing plaintext Verita";
                if (!encrypt && supplyKey) describeText = "reconstructing plaintext Verita, supplying a spurious decryption key";
                if (encrypt && !supplyKey) describeText = "trying to reconstruct encrypted Verita without a decryption key";
                if (encrypt && supplyKey) describeText = "reconstructing encrypted Verita";
                describe(describeText, () => {

                  describe(`${chunkNo}-chunk PAYLOAD-only ${CubeType[cubeType]} Veritum`, () => {
                    let text: string;
                    let veritum: Veritum;
                    let veritumKey: CubeKey;
                    let veritumFields: VerityField[];
                    let veritumChunks: cciCube[];
                    let firstCompilationChunks: cciCube[];
                    let firstCompilationBinaryData: Buffer[];


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

                      // Perform test:
                      // compile Veritum and remember key
                      await veritum.compile({
                        recipients: encrypt? encryptionRecipientPublicKey : undefined,
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

                      // verify intermediate state:
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

                      // Perform the restore
                      const options: VeritumFromChunksOptions = {
                        privateKey: roundTrips > 1? privateKey : undefined,
                        requiredDifficulty: 0,
                      }
                      if (supplyKey) {
                        // In some test setups, we will be extra mean and still
                        // pass a decryption private key
                        // even though there is nothing to decrypt.
                        options.recipientPrivateKey = encryptionRecipientPrivateKey;
                        if (roundTrips > 1) options.privateKey = privateKey;
                      }
                      reconstructed = Veritum.FromChunks(veritum.chunks, options);

                      // if this is a dual round-trip test, do another compile/decompile
                      // round-trip
                      if (roundTrips > 1) {
                        // preserve previous compilation round's chunks and their
                        // binary data so we can
                        // later assert that the Veritum has actually been compiled
                        // a second time, rather than reusing the existing chunks
                        firstCompilationChunks = Array.from(reconstructed.chunks);
                        firstCompilationBinaryData = [];
                        for (const chunk of firstCompilationChunks) {
                          const bin: Buffer = chunk.getBinaryDataIfAvailable();
                          expect(bin.length).toBe(NetConstants.CUBE_SIZE);
                          firstCompilationBinaryData.push(Buffer.from(bin));
                        }

                        // recompile
                        await reconstructed.compile({
                          recipients: encrypt? encryptionRecipientPublicKey : undefined,
                          requiredDifficulty: 0,  // TODO remove should not be required
                        });
                      }
                    });  // beforeAll

                    if (roundTrips > 1) {
                      // assert actually recompiled
                      it('creates the same number of chunks on both compilations', () => {
                        const recompiledChunks = Array.from(reconstructed.chunks);
                        expect(recompiledChunks.length).toEqual(firstCompilationChunks.length);
                      });

                      it('actually recompiles the Veritum (i.e. objects are not identical)', () => {
                        const recompiledChunks = Array.from(reconstructed.chunks);
                        for (let i=0; i<recompiledChunks.length; i++) {
                          // assert Chunk cube objects are not the same
                          const recompiledChunk: cciCube = recompiledChunks[i];
                          const previousChunk: cciCube = firstCompilationChunks[i];
                          expect(recompiledChunk === previousChunk).toBe(false);

                          // fetch previous and recompiled chunks' binary data
                          const recompiledBinaryData: Buffer = recompiledChunk.getBinaryDataIfAvailable();
                          expect(recompiledBinaryData.length).toEqual(NetConstants.CUBE_SIZE);
                          const previousBinaryData: Buffer = previousChunk.getBinaryDataIfAvailable();
                          expect(previousBinaryData.length).toEqual(NetConstants.CUBE_SIZE);

                          // assert binary data Buffers are not the same
                          // (should be equal though, will check for equality in the test below)
                          expect(recompiledBinaryData === previousBinaryData).toBe(false);
                        }
                      });

                      if (!encrypt && !HasSignature[cubeType]) it('first and second compilation yield identical chunk keys', () => {
                        // Note: Encrypted hash-key-type Verita will by design yield different keys
                        // on recompilation as we use ephemeral sender keys and,
                        // more importantly, random nonces for security.
                        const recompiledChunks = Array.from(reconstructed.chunks);
                        for (let i=0; i<recompiledChunks.length; i++) {
                          // assert Chunk cube objects are not the same
                          const recompiledChunk: cciCube = recompiledChunks[i];
                          const previousChunk: cciCube = firstCompilationChunks[i];

                          expect(recompiledChunk.getKeyIfAvailable().length).toBe(NetConstants.CUBE_KEY_SIZE);
                          expect(previousChunk.getKeyIfAvailable().length).toBe(NetConstants.CUBE_KEY_SIZE);
                          expect(recompiledChunk.getKeyIfAvailable().equals(previousChunk.getKeyIfAvailable())).toBe(true);
                        }
                      });

                      if (!encrypt) it('first and second compilation yield identical binary chunks', () => {
                        // Note: Encrypted Verita will by design yield different binaries
                        // on recompilation as we use ephemeral sender keys and,
                        // more importantly, random nonces for security.
                        const recompiledChunks = Array.from(reconstructed.chunks);
                        for (let i=0; i<recompiledChunks.length; i++) {
                          // assert Chunk cube objects are not the same
                          const recompiledChunk: cciCube = recompiledChunks[i];
                          const previousChunk: cciCube = firstCompilationChunks[i];

                          expect(recompiledChunk.getBinaryDataIfAvailable().length).toBe(NetConstants.CUBE_SIZE);
                          expect(previousChunk.getBinaryDataIfAvailable().length).toBe(NetConstants.CUBE_SIZE);
                          expect(recompiledChunk.getBinaryDataIfAvailable().equals(previousChunk.getBinaryDataIfAvailable())).toBe(true);
                        }
                      });
                    }

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

                    if (!encrypt || roundTrips < 2) it("the reconstructed Veritum should have the original Veritum's key", () => {
                      // Note that on encrypted Verita the keys will change after
                      // more than one round trip, as we use a new random nonce
                      // as well as a new ephemeral sender key on recompilation
                      // for security.
                      expect(reconstructed.getKeyIfAvailable()).toBeInstanceOf(Buffer);
                      expect(reconstructed.getKeyIfAvailable().equals(veritumKey)).toBe(true);
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

                    if (HasNotify[cubeType]) it.todo("will retain the notification");
                    it.todo("will retain the original DATE");
                    if (cubeType === CubeType.PMUC || cubeType === CubeType.PMUC_NOTIFY) it.todo("will retain the PMUC update count");
                  });
                });  // describe combination of options
              });
            }  // for number of round trips
          }
        }  // for cubeType
      }  // for chunkNo

      it.todo("will retain the first chunk's DATE field even if the user did not supply one");
    });  // round-trip tests
  });  // compile()
});
