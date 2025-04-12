import { cciCube } from "../../../src/cci/cube/cciCube";
import { MediaTypes, FieldType } from "../../../src/cci/cube/cciCube.definitions";
import { VerityField } from "../../../src/cci/cube/verityField";
import { Recombine } from "../../../src/cci/veritum/continuation";
import { Veritum } from "../../../src/cci/veritum/veritum";
import { CubeType } from "../../../src/core/cube/cube.definitions";
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
    // Note:
    // - This suite contains basic compilation tests
    // - More comprehensive high level tests involving compilation/decompilation
    //   round trips are in veritum.compile.combinatorial.test.ts
    // - Basic encryption tests are in veritumEncryption.test.ts

    describe('splitting', () => {
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
    });  // compile() splitting tests
  });  // compile()
});
