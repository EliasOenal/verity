import { cciCube } from "../../../src/cci/cube/cciCube";
import { MediaTypes, FieldType } from "../../../src/cci/cube/cciCube.definitions";
import { VerityField } from "../../../src/cci/cube/verityField";
import { Recombine } from "../../../src/cci/veritum/continuation";
import { Veritum } from "../../../src/cci/veritum/veritum";
import { CubeType, CubeKey, NotificationKey } from "../../../src/core/cube/cube.definitions";
import { NetConstants } from "../../../src/core/networking/networkDefinitions";

import { evenLonger, tooLong } from "../testcci.definitions";
import { Relationship, RelationshipType } from "../../../src/cci/cube/relationship";

import sodium from 'libsodium-wrappers-sumo'
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

const requiredDifficulty = 0;

describe('Veritum compilation/decompilation tests', () => {
  const applicationField = VerityField.Application("contentum probationis non applicationis");
  const mediaTypeField = VerityField.MediaType(MediaTypes.TEXT);
  const payloadField = VerityField.Payload("Hoc veritum probatio est");
  const notificationField = VerityField.Notify(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x69) as NotificationKey);

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
    // Note:
    // - This suite contains basic compilation tests
    // - More comprehensive high level tests involving compilation/decompilation
    //   round trips are in veritum.compile.combinatorial.test.ts
    // - Basic encryption tests are in veritumEncryption.test.ts

    describe('splitting-only tests', () => {
      it('compiles a short frozen Veritum to a single Frozen Cube', async() => {
        const veritum = new Veritum({
          cubeType: CubeType.FROZEN,
          fields: payloadField,
          requiredDifficulty,
        });
        const cubesIterable: Iterable<cciCube> = await veritum.compile();
        expect(cubesIterable).toEqual(veritum.chunks);
        const compiled: cciCube[] = Array.from(cubesIterable);
        expect(compiled.length).toBe(1);
        expect(compiled[0].cubeType).toBe(CubeType.FROZEN);
        expect(compiled[0].getFirstField(FieldType.PAYLOAD).equals(payloadField)).toBeTruthy();
      });

      it('will split a notification Veritum into a leading notification Cube followed by non-notification Cubes', async () => {
        const veritum = new Veritum({
          cubeType: CubeType.PIC_NOTIFY,
          fields: [
            notificationField,
            VerityField.Payload(evenLonger),
          ],
          requiredDifficulty,
        });
        await veritum.compile();

        const chunks: cciCube[] = Array.from(veritum.chunks);
        expect(chunks.length).toBe(3);

        expect(chunks[0].cubeType).toBe(CubeType.PIC_NOTIFY);
        expect(chunks[1].cubeType).toBe(CubeType.PIC);
        expect(chunks[2].cubeType).toBe(CubeType.PIC);

        expect(chunks[0].getFirstField(FieldType.NOTIFY).equals(notificationField)).toBe(true);
        expect(chunks[1].getFirstField(FieldType.NOTIFY)).toBeUndefined();
        expect(chunks[2].getFirstField(FieldType.NOTIFY)).toBeUndefined();
      });

      it.todo('will ensure all resulting chunks have the same date if not encrypted');

      it.todo('can split MUCs and PMUCs');  // not currently implemented, Github#634
      it.todo('automatically sets and updates the PMUC update count');  // not currently implemented, Github#634
    });  // splitting-only tests

    describe('splitting and restoring round trip tests', () => {
      it('compiles a long frozen Veritum to multiple Frozen Cubes', async() => {
        const veritum = new Veritum({
          cubeType: CubeType.FROZEN,
          fields: VerityField.Payload(tooLong),
          requiredDifficulty,
        });
        await veritum.compile();
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

      it('compiles and restores a single PIC Veritum from binary', async () => {
        // Sculpt a single-Cube PIC Veritum.
        const short = "Verita brevia unum tantum cubum exigunt";
        const singleCube: Veritum = new Veritum({
          cubeType: CubeType.PIC,
          fields: [
            VerityField.Payload(short),
            VerityField.Date(),  // add DATE explicitly just to simplify comparison
          ],
          requiredDifficulty: 0,
        });

        // Compile it all the way down to binary.
        await singleCube.compile();
        const singleChunk: cciCube = Array.from(singleCube.chunks)[0];
        const singleCubeBin: Buffer = singleChunk.getBinaryDataIfAvailable();
        // Compilation should make both the Veritum and the chunk know their key.
        const key: CubeKey = singleCube.getKeyIfAvailable();
        expect(key.length).toBe(NetConstants.CUBE_KEY_SIZE);
        expect(singleChunk.getKeyIfAvailable().equals(key)).toBe(true);

        // Restore the binary chunk
        const restoredChunk: cciCube = new cciCube(singleCubeBin);
        expect(restoredChunk.cubeType).toBe(CubeType.PIC);
        expect(restoredChunk.getFirstField(FieldType.PAYLOAD).valueString).toEqual(short);
        expect(restoredChunk.getFirstField(FieldType.DATE)).toBeDefined();
        expect(restoredChunk.getFirstField(FieldType.DATE).value.equals(
          singleCube.getFirstField(FieldType.DATE).value)).toBe(true);

        // Restore the Veritum from the restored chunk
        const restoredVeritum = Veritum.FromChunks([restoredChunk]);
        expect(restoredVeritum).toBeInstanceOf(Veritum);
        expect(restoredVeritum.cubeType).toBe(CubeType.PIC);
        expect(restoredVeritum.getFirstField(FieldType.PAYLOAD).valueString).toEqual(short);
        expect(restoredVeritum.getFirstField(FieldType.DATE)).toBeDefined();
        expect(restoredVeritum.getFirstField(FieldType.DATE).value.equals(
          singleCube.getFirstField(FieldType.DATE).value)).toBe(true);
        expect((await restoredVeritum.getKey()).equals(key)).toBe(true);
      });

      it('compiles and restores a three-chunk PIC Veritum from binary', async () => {
        const veritum: Veritum = new Veritum({
          cubeType: CubeType.PIC,
          fields: [
            VerityField.Payload(evenLonger),
            VerityField.Date(),  // add DATE explicitly just to simplify comparison
          ],
          requiredDifficulty: 0,
        });

        // Compile it all the way down to binary
        await veritum.compile();
        const chunks: cciCube[] = Array.from(veritum.chunks);
        expect(chunks.length).toBe(3);
        const binaryChunks: Buffer[] =
          chunks.map(chunk => chunk.getBinaryDataIfAvailable());

        // Compilation should make both the Veritum and all chunks to know their key.
        const key: CubeKey = veritum.getKeyIfAvailable();
        expect(key.length).toBe(NetConstants.CUBE_KEY_SIZE);
        expect(chunks[0].getKeyIfAvailable().equals(key)).toBe(true);
        expect(chunks[1].getKeyIfAvailable().length).toBe(NetConstants.CUBE_KEY_SIZE);
        expect(chunks[1].getKeyIfAvailable().equals(key)).toBe(false);
        expect(chunks[2].getKeyIfAvailable().length).toBe(NetConstants.CUBE_KEY_SIZE);
        expect(chunks[2].getKeyIfAvailable().equals(key)).toBe(false);

        // restore the binary chunks
        const restoredChunks: cciCube[] = binaryChunks.map(chunk => new cciCube(chunk));
        expect(restoredChunks.length).toBe(3);
        for (const chunk of restoredChunks) {
          expect(chunk.cubeType).toBe(CubeType.PIC);
          expect(chunk.getFirstField(FieldType.PAYLOAD)).toBeDefined();
          expect(evenLonger).toContain(chunk.getFirstField(FieldType.PAYLOAD).valueString);
        }
        // restored binary chunks should know their keys
        expect(restoredChunks[0].getKeyIfAvailable().equals(key)).toBe(true);
        expect(restoredChunks[1].getKeyIfAvailable().equals(
          chunks[1].getKeyIfAvailable())).toBe(true);
        expect(restoredChunks[2].getKeyIfAvailable().equals(
          chunks[2].getKeyIfAvailable())).toBe(true);

        // Restore the Veritum from the restored chunks
        const restoredVeritum: Veritum = Veritum.FromChunks(restoredChunks);
        expect(restoredVeritum).toBeInstanceOf(Veritum);
        expect(restoredVeritum.cubeType).toBe(CubeType.PIC);
        expect(restoredVeritum.getFirstField(FieldType.PAYLOAD).valueString).toEqual(evenLonger);
        expect(restoredVeritum.getFirstField(FieldType.DATE)).toBeDefined();
        expect(restoredVeritum.getFirstField(FieldType.DATE).value.equals(
          veritum.getFirstField(FieldType.DATE).value)).toBe(true);
        expect((await restoredVeritum.getKey()).equals(key)).toBe(true);
        expect(restoredVeritum.equals(veritum)).toBe(true);
      });

    });
  });  // compile()
});
