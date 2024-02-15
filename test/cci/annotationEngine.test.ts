import { AnnotationEngine, defaultGetFieldsFunc } from '../../src/cci/annotationEngine';
import { Cube } from '../../src/core/cube/cube';
import { CubeStore as CubeStore } from '../../src/core/cube/cubeStore';

import sodium, { KeyPair } from 'libsodium-wrappers-sumo'
import { cciField, cciFieldParsers, cciRelationship, cciRelationshipType } from '../../src/cci/cube/cciFields';
import { cciCube } from '../../src/cci/cube/cciCube';

describe('annotationEngine', () => {
  let cubeStore: CubeStore;
  let annotationEngine: AnnotationEngine;
  let reduced_difficulty = 0;

  beforeEach(() => {
    cubeStore = new CubeStore({
      enableCubePersistance: false,
      requiredDifficulty: 0,
    });
  }, 3000);

  describe('default settings', () => {
    beforeEach(() => {
      annotationEngine = new AnnotationEngine(cubeStore);
    }, 3000);

    it('correctly creates a reverse relationship', async () => {
      const referee = cciCube.Dumb([], cciFieldParsers, reduced_difficulty);
      const referrer = cciCube.Dumb(
        cciField.RelatesTo(new cciRelationship(
          cciRelationshipType.CONTINUED_IN, await referee.getKey())),
        cciFieldParsers, reduced_difficulty);
      await cubeStore.addCube(referrer);

      const reverserels = annotationEngine.getReverseRelationships(await referee.getKey());
      expect(reverserels.length).toEqual(1);
      expect(reverserels[0].type).toEqual(cciRelationshipType.CONTINUED_IN);
      expect(reverserels[0].remoteKey.toString('hex')).toEqual((await referrer.getKey()).toString('hex'));
    });
  });

  describe('individual settings', () => {
    it('does only create the annotations requested', async () => {
      // Let's say we only want to annotate a MENTION reference, and no more than a single one
      const annotationSpec = new Map([
        [cciRelationshipType.MENTION, 1]
      ]);
      const annotationEngine = new AnnotationEngine(
        cubeStore, defaultGetFieldsFunc, cciRelationship, annotationSpec);

      // Let's create a non-conforming Cube that MENTIONs two MUCs and defines a
      // CONTINUED_IN relationship as well.
      // First all of our referred cubes:
      await sodium.ready;
      const muckeys1: KeyPair = sodium.crypto_sign_keypair();
      const muckeys2: KeyPair = sodium.crypto_sign_keypair();
      const muc1 = Cube.MUC(Buffer.from(muckeys1.publicKey), Buffer.from(muckeys1.privateKey));
      const muc2 = Cube.MUC(Buffer.from(muckeys2.publicKey), Buffer.from(muckeys2.privateKey));
      const continuedin = cciCube.Dumb(cciField.Payload("Multum habeo dicere"),
        cciFieldParsers, reduced_difficulty);

      // And now the offender themselves:
      const nonconformingCube = cciCube.Dumb([
          cciField.RelatesTo(new cciRelationship(
            cciRelationshipType.MENTION, await muc1.getKey())),
          cciField.RelatesTo(new cciRelationship(
            cciRelationshipType.MENTION, await muc2.getKey())),
          cciField.RelatesTo(new cciRelationship(
            cciRelationshipType.CONTINUED_IN, await continuedin.getKey()))
        ], cciFieldParsers, reduced_difficulty);
      await cubeStore.addCube(nonconformingCube);

      // As requested, only the first MENTION is annotated and nothing else
      expect(annotationEngine.reverseRelationships.size).toEqual(1);
      expect(annotationEngine.getReverseRelationships(await muc1.getKey()).length).toEqual(1);
      const onlyReverseRelStored = annotationEngine.getReverseRelationships(await muc1.getKey())[0];
      expect(onlyReverseRelStored.type).toEqual(cciRelationshipType.MENTION);
      expect(onlyReverseRelStored.remoteKey.equals(await nonconformingCube.getKey())).toBeTruthy();

      expect(annotationEngine.getReverseRelationships(await muc2.getKey()).length).toEqual(0);
      expect(annotationEngine.getReverseRelationships(await continuedin.getKey()).length).toEqual(0);
    });
  });
});
