import { Cube } from '../../src/core/cube/cube';
import { CubeStore as CubeStore } from '../../src/core/cube/cubeStore';

import { VerityField } from '../../src/cci/cube/verityField';
import { cciRelationship, cciRelationshipType } from '../../src/cci/cube/cciRelationship';
import { cciCube } from '../../src/cci/cube/cciCube';
import { AnnotationEngine, defaultGetFieldsFunc } from '../../src/cci/annotationEngine';

import sodium, { KeyPair } from 'libsodium-wrappers-sumo'
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('annotationEngine', () => {
  let cubeStore: CubeStore;
  let annotationEngine: AnnotationEngine;
  const reducedDifficulty = 0;

  beforeEach(async () => {
    cubeStore = new CubeStore({
      inMemory: true,
      enableCubeCache: false,
      requiredDifficulty: 0,
      enableCubeRetentionPolicy: false,
    });
    await cubeStore.readyPromise;
  }, 3000);

  describe('default settings', () => {
    beforeEach(async () => {
      annotationEngine = await AnnotationEngine.Construct(cubeStore);
    }, 3000);

    afterEach(() => {
      annotationEngine.shutdown();
    });

    describe('getReverseRelationships()', () => {
      it('correctly creates a reverse relationship', async () => {
        const referee = cciCube.Frozen({requiredDifficulty: reducedDifficulty});
        const referrer = cciCube.Frozen({
          fields: VerityField.RelatesTo(new cciRelationship(
            cciRelationshipType.CONTINUED_IN, await referee.getKey())),
          requiredDifficulty: reducedDifficulty
        });
        await cubeStore.addCube(referrer);

        const reverserels = annotationEngine.getReverseRelationships(await referee.getKey());
        expect(reverserels.length).toEqual(1);
        expect(reverserels[0].type).toEqual(cciRelationshipType.CONTINUED_IN);
        expect(reverserels[0].remoteKey.toString('hex')).toEqual((await referrer.getKey()).toString('hex'));
      });
    });

    describe('shutdown()', () => {
      it('will release all event subscriptions', async () => {
        // AnnotationEngine holds a single subscription to its CubeEmitter's
        // "cubeAdded" event
        expect(cubeStore.listenerCount('cubeAdded')).toBe(1);
        annotationEngine.shutdown();
        expect(cubeStore.listenerCount('cubeAdded')).toBe(0);
      });
    });
  });

  describe('individual settings', () => {
    it('does only create the annotations requested', async () => {
      // Let's say we only want to annotate a MENTION reference, and no more than a single one
      const annotationSpec = new Map([
        [cciRelationshipType.MENTION, 1]
      ]);
      const annotationEngine: AnnotationEngine = await AnnotationEngine.Construct(
        cubeStore, defaultGetFieldsFunc, cciRelationship, annotationSpec);

      // Let's create a non-conforming Cube that MENTIONs two MUCs and defines a
      // CONTINUED_IN relationship as well.
      // First all of our referred cubes:
      await sodium.ready;
      const muckeys1: KeyPair = sodium.crypto_sign_keypair();
      const muckeys2: KeyPair = sodium.crypto_sign_keypair();
      const muc1 = Cube.MUC(Buffer.from(muckeys1.publicKey), Buffer.from(muckeys1.privateKey));
      const muc2 = Cube.MUC(Buffer.from(muckeys2.publicKey), Buffer.from(muckeys2.privateKey));
      const continuedin = cciCube.Frozen({
        fields: VerityField.Payload("Multum habeo dicere"),
        requiredDifficulty: reducedDifficulty
      });

      // And now the offender themselves:
      const nonconformingCube = cciCube.Frozen({
        fields: [
          VerityField.RelatesTo(new cciRelationship(
            cciRelationshipType.MENTION, await muc1.getKey())),
          VerityField.RelatesTo(new cciRelationship(
            cciRelationshipType.MENTION, await muc2.getKey())),
          VerityField.RelatesTo(new cciRelationship(
            cciRelationshipType.CONTINUED_IN, await continuedin.getKey()))
        ],
        requiredDifficulty: reducedDifficulty
      });
      await cubeStore.addCube(nonconformingCube);

      // As requested, only the first MENTION is annotated and nothing else
      expect(annotationEngine.reverseRelationships.size).toEqual(1);
      expect(annotationEngine.getReverseRelationships(await muc1.getKey()).length).toEqual(1);
      const onlyReverseRelStored = annotationEngine.getReverseRelationships(await muc1.getKey())[0];
      expect(onlyReverseRelStored.type).toEqual(cciRelationshipType.MENTION);
      expect(onlyReverseRelStored.remoteKey.equals(await nonconformingCube.getKey())).toBeTruthy();

      expect(annotationEngine.getReverseRelationships(await muc2.getKey()).length).toEqual(0);
      expect(annotationEngine.getReverseRelationships(await continuedin.getKey()).length).toEqual(0);

      annotationEngine.shutdown();
    });
  });
});
