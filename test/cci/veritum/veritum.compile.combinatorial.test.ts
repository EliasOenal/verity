import { NetConstants } from "../../../src/core/networking/networkDefinitions";
import { CubeKey, CubeType, HasNotify, HasSignature, NotificationKey } from "../../../src/core/cube/cube.definitions";
import { enumNums } from "../../../src/core/helpers/misc";

import { cciCube } from "../../../src/cci/cube/cciCube";
import { FieldType } from "../../../src/cci/cube/cciCube.definitions";
import { VerityField } from "../../../src/cci/cube/verityField";
import { VeritumFromChunksOptions } from "../../../src/cci/veritum/veritum.definitions";
import { Veritum } from "../../../src/cci/veritum/veritum";

import sodium from 'libsodium-wrappers-sumo'
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';


describe('Veritum compilation/decompilation combinatorial round-trip tests', () => {

  // This is a combinatorial test suite, testing Veritum compilation/decompilation
  // round trips for all possible combinations of:
  // - Cube type, including notification types
  // - Length of Veritum (number of required chunks from 1 to 3)
  // - Encrypted or plain text;
  //   and for both of these, whether or not a key is supplied on decompilation
  // - Number of compile/decompile round trips (1 to 3)
  // - Whether the Veritum is reconstructed through the low-level Binary
  //   interface or through the high-level Cube interface

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


  for (const chunkNo of [1, 2, 3]) {
    for (const cubeType of enumNums(CubeType)) {
      // multi-chunk signed Verita not implemented, see Github#634
      if (HasSignature[cubeType] && chunkNo > 1) continue;

      for (const encrypt of [true, false]) for (const supplyKey of [true, false]) {
        for (const roundTrips of [1, 2, 3]) for (const throughBinary of [true, false]) {
          if (encrypt && !supplyKey && roundTrips > 1) continue;  // cannot do extra round trip on unrestorable Veritum
          describe(`performing ${roundTrips === 1? 'a single round trip': roundTrips + ' round trips'}, ${throughBinary? 'low-level (through Binary)' : 'high level (through chunk Cube objects'}`, () => {
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
                let originalChunks: cciCube[];
                let reconstructed: Veritum;
                let firstRestoreVeritum: Veritum;
                let firstRestoreChunks: cciCube[];
                let firstRestoreBinaryData: Buffer[];
                const notify = VerityField.Notify(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x42) as NotificationKey);


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
                    fields: HasNotify[cubeType] ? [payload, notify, VerityField.Date()] : [payload, VerityField.Date()],
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
                  originalChunks = Array.from(veritum.chunks);

                  // verify intermediate state:
                  // - if encrypted, assert the compiled chunks contain no plaintext
                  // - if not encrypted, assert the compiled chunks do contain plaintext
                  if (encrypt) {
                    for (const chunk of originalChunks) {
                      expect(chunk.getFirstField(FieldType.PAYLOAD)).toBeUndefined();
                      expect(chunk.getBinaryDataIfAvailable()).toBeInstanceOf(Buffer);
                      expect(chunk.getBinaryDataIfAvailable().toString('utf-8')).not.toContain('Haec veritum');
                    }
                  } else {
                    for (const chunk of originalChunks) {
                      expect(chunk.getFirstField(FieldType.PAYLOAD)).toBeDefined();
                    }
                  }

                  // If specified, go low level by converting the chunks
                  // themselves to binary and back -- just as it would happen
                  // when a Veritum is sent over the wire.
                  const chunksForRestore: cciCube[] = [];
                  if (throughBinary) {
                    for (const chunk of veritum.chunks) {
                      // convert chunk to binary by fetching the
                      // already-compiled binary data
                      const bin: Buffer = chunk.getBinaryDataIfAvailable();
                      // sanity check chunk binary
                      expect(bin.length).toBe(NetConstants.CUBE_SIZE);

                      // convert binary chunk back to Cube object
                      const restoredChunk: cciCube = new cciCube(bin);
                      // sanity check restored chunk
                      expect((await chunk.getKey()).equals(await restoredChunk.getKey())).toBe(true);
                      // expect(restoredChunk.equals(chunk)).toBeTruthy();

                      chunksForRestore.push(restoredChunk);
                    }
                    // verify we've actually gone low-level by asserting
                    // the chunks are not the same as the original Veritum's chunks
                    for (let i=0; i<chunksForRestore.length; i++) {
                      expect(chunksForRestore[i] === originalChunks[i]).toBe(false);
                    }
                  } else chunksForRestore.push(...originalChunks);

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
                  reconstructed = Veritum.FromChunks(chunksForRestore, options);
                  firstRestoreVeritum = reconstructed;

                  // Preserve this compilation round's chunks and their
                  // binary data. In case of multi-round-trip tests, we can use this to
                  // later assert that the Veritum has actually been compiled
                  // another time, rather than reusing the existing chunks
                  firstRestoreChunks = Array.from(reconstructed.chunks);
                  firstRestoreBinaryData = [];
                  for (const chunk of firstRestoreChunks) {
                    const bin: Buffer = chunk.getBinaryDataIfAvailable();
                    expect(bin.length).toBe(NetConstants.CUBE_SIZE);
                    firstRestoreBinaryData.push(Buffer.from(bin));
                  }

                  // if this is a multi round-trip test, do further compile/decompile
                  // round-trip
                  let tripsRemaining = roundTrips - 1;
                  while (tripsRemaining > 0) {
                    tripsRemaining--;

                    // recompile
                    const chPre = Array.from(reconstructed.chunks);
                    await reconstructed.compile({
                      recipients: encrypt? encryptionRecipientPublicKey : undefined,
                      requiredDifficulty: 0,  // TODO remove should not be required
                    });
                    // assert actually recompiled
                    const chPost = Array.from(reconstructed.chunks);
                    expect(chPre.length).toEqual(chPost.length);
                    for (let i=0; i<chPre.length; i++) {
                      expect(chPre[i] === chPost[i]).toBe(false);
                    }

                    // if this is a low-level test going through binary
                    // (as if the Veritum was sent over the wire),
                    // convert the chunks to binary and back
                    const chunksForAnotherRestore: cciCube[] = [];
                    if (throughBinary) {
                      for (const chunk of reconstructed.chunks) {
                        // convert chunk to binary by fetching the
                        // already-compiled binary data
                        const bin: Buffer = chunk.getBinaryDataIfAvailable();
                        // sanity check chunk binary
                        expect(bin.length).toBe(NetConstants.CUBE_SIZE);

                        // convert binary chunk back to Cube object
                        const restoredChunk: cciCube = new cciCube(bin);
                        // sanity check restored chunk
                        expect((await chunk.getKey()).equals(await restoredChunk.getKey())).toBe(true);
                        // expect(restoredChunk.equals(chunk)).toBeTruthy();
                        chunksForAnotherRestore.push(restoredChunk);
                      }
                      // verify we've actually gone low-level by asserting
                      // the chunks are not the same as on the first round
                      for (let i=0; i<chunksForRestore.length; i++) {
                        expect(chunksForRestore[i] === chunksForAnotherRestore[i]).toBe(false);
                      }
                    } else chunksForAnotherRestore.push(...reconstructed.chunks);

                    // decompile
                    reconstructed = Veritum.FromChunks(chunksForAnotherRestore, options);
                  }
                });  // beforeAll

                // Tests start here!
                // First, some tests exclusive to multi-round-trip scenarios:

                if (roundTrips > 1) {
                  it('creates the same number of chunks on first and last compilation', () => {
                    const recompiledChunks = Array.from(reconstructed.chunks);
                    expect(recompiledChunks.length).toEqual(firstRestoreChunks.length);
                  });

                  it('actually recompiles the Veritum (i.e. objects are not identical)', () => {
                    // assert Veritum object is not the same
                    expect(reconstructed === firstRestoreVeritum).toBe(false);
                    // assert Chunk cube objects are not the same
                    const recompiledChunks = Array.from(reconstructed.chunks);
                    for (let i=0; i<recompiledChunks.length; i++) {
                      // assert Chunk cube objects are not the same
                      const recompiledChunk: cciCube = recompiledChunks[i];
                      const previousChunk: cciCube = firstRestoreChunks[i];
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

                  if (!encrypt && !HasSignature[cubeType]) it('first and last compilation yield identical chunk keys', () => {
                    // Note: Encrypted hash-key-type Verita will by design yield different keys
                    // on recompilation as we use ephemeral sender keys and,
                    // more importantly, random nonces for security.
                    const recompiledChunks = Array.from(reconstructed.chunks);
                    for (let i=0; i<recompiledChunks.length; i++) {
                      // assert Chunk cube objects are not the same
                      const recompiledChunk: cciCube = recompiledChunks[i];
                      const previousChunk: cciCube = firstRestoreChunks[i];

                      expect(recompiledChunk.getKeyIfAvailable().length).toBe(NetConstants.CUBE_KEY_SIZE);
                      expect(previousChunk.getKeyIfAvailable().length).toBe(NetConstants.CUBE_KEY_SIZE);
                      expect(recompiledChunk.getKeyIfAvailable().equals(previousChunk.getKeyIfAvailable())).toBe(true);
                    }
                  });

                  if (!encrypt) it('first and last compilation yield identical binary chunks', () => {
                    // Note: Encrypted Verita will by design yield different binaries
                    // on recompilation as we use ephemeral sender keys and,
                    // more importantly, random nonces for security.
                    const recompiledChunks = Array.from(reconstructed.chunks);
                    for (let i=0; i<recompiledChunks.length; i++) {
                      // assert Chunk cube objects are not the same
                      const recompiledChunk: cciCube = recompiledChunks[i];
                      const previousChunk: cciCube = firstRestoreChunks[i];

                      expect(recompiledChunk.getBinaryDataIfAvailable().length).toBe(NetConstants.CUBE_SIZE);
                      expect(previousChunk.getBinaryDataIfAvailable().length).toBe(NetConstants.CUBE_SIZE);
                      expect(recompiledChunk.getBinaryDataIfAvailable().equals(previousChunk.getBinaryDataIfAvailable())).toBe(true);
                    }
                  });
                }  // tests exclusively for multi-round-trip scenarios

                // General tests run in all scenarios start here :)

                it('does not change the original Veritum or its chunks', () => {
                  expect(veritum.getKeyIfAvailable()).toEqual(veritumKey);

                  const fieldsAfter: VerityField[] = Array.from(veritum.getFields());
                  expect(fieldsAfter.length).toBe(veritumFields.length);
                  for (let i = 0; i < veritumFields.length; i++) {
                    expect(fieldsAfter[i]).not.toBe(veritumFields[i]);
                    expect(fieldsAfter[i].equals(veritumFields[i])).toBeTruthy();
                  }

                  const chunksAfter: cciCube[] = Array.from(veritum.chunks);
                  expect(chunksAfter.length).toBe(originalChunks.length);
                  for (let i = 0; i < originalChunks.length; i++) {
                    // assert the original Veritum still retains the exact
                    // same chunk objects it had after compilation
                    expect(chunksAfter[i]).toBe(originalChunks[i]);
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

                it("retains the original Veritum's Cube type", () => {
                  expect(reconstructed.cubeType).toEqual(veritum.cubeType);
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

                if (HasNotify[cubeType]) it("will retain the notification", () => {
                  expect(reconstructed.getFirstField(FieldType.NOTIFY)).toBeDefined();
                  expect(reconstructed.getFirstField(FieldType.NOTIFY).equals(notify)).toBeTruthy();
                });
                else it("does not have a spurious notification field", () => {
                  expect(reconstructed.getFirstField(FieldType.NOTIFY)).toBeUndefined();
                });

                // DATE should be retained on unencrypted Verita, while on
                // encrypted ones it should be obfuscated within a certain
                // period to avoid leaking the exact sculpting time
                // (not yet implemented)
                if (!encrypt) it("will retain the original DATE", () => {
                  const reconstructedDate = reconstructed.getFirstField(FieldType.DATE);
                  const originalDate = veritum.getFirstField(FieldType.DATE);
                  expect(reconstructedDate.value.equals(originalDate.value));
                });
                else it.todo('should obfuscate the DATE field');

                // Note: Multi-chunk signed Verita currently not implemented; Github#634
                if (cubeType === CubeType.PMUC || cubeType === CubeType.PMUC_NOTIFY) it.todo("will retain the PMUC update count");
              });
            });  // describe combination of options
          });
        }  // for number of round trips; for restoration through binary or through Cube objects
      }
    }  // for cubeType
  }  // for chunkNo

  it.todo("will retain the first chunk's DATE field even if the user did not supply one");
});
