import { AnnotationEngine, defaultGetFieldsFunc } from '../../src/cci/annotationEngine';
import { Cube } from '../../src/core/cube/cube';
import { CubeStore as CubeStore } from '../../src/core/cube/cubeStore';
import { CubeField, CubeFields, CubeRelationship, CubeRelationshipType } from '../../src/core/cube/cubeFields';

import sodium, { KeyPair } from 'libsodium-wrappers'

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
      const referrer = new Cube(undefined, reduced_difficulty);
      const referee = new Cube(undefined, reduced_difficulty);

      referrer.setFields(
        CubeField.RelatesTo(new CubeRelationship(
          CubeRelationshipType.CONTINUED_IN, await referee.getKey())
        ));
      await cubeStore.addCube(referrer);

      const reverserels = annotationEngine.getReverseRelationships(await referee.getKey());
      expect(reverserels.length).toEqual(1);
      expect(reverserels[0].type).toEqual(CubeRelationshipType.CONTINUED_IN);
      expect(reverserels[0].remoteKey.toString('hex')).toEqual((await referrer.getKey()).toString('hex'));
    });
  });

  describe('individual settings', () => {
    it('does only create the annotations requested', async () => {
      // Let's say we only want to annotate a MENTION reference, and no more than a single one
      const annotationSpec = new Map([
        [CubeRelationshipType.MENTION, 1]
      ]);
      const annotationEngine = new AnnotationEngine(cubeStore, defaultGetFieldsFunc, CubeRelationship, annotationSpec);

      // Let's create a non-conforming Cube that MENTIONs two MUCs and defines a
      // CONTINUED_IN relationship as well.
      // First all of our referred cubes:
      await sodium.ready;
      const muckeys1: KeyPair = sodium.crypto_sign_keypair();
      const muckeys2: KeyPair = sodium.crypto_sign_keypair();
      const muc1 = Cube.MUC(Buffer.from(muckeys1.publicKey), Buffer.from(muckeys1.privateKey));
      const muc2 = Cube.MUC(Buffer.from(muckeys2.publicKey), Buffer.from(muckeys2.privateKey));
      const continuedin = new Cube(undefined, reduced_difficulty);
      continuedin.setFields(CubeField.Payload("I still got much to say"));

      // And now the offender themselves:
      const nonconformingCube = new Cube(undefined, reduced_difficulty);
      nonconformingCube.setFields(new CubeFields([
        CubeField.RelatesTo(new CubeRelationship(
          CubeRelationshipType.MENTION, await muc1.getKey())),
        CubeField.RelatesTo(new CubeRelationship(
          CubeRelationshipType.MENTION, await muc2.getKey())),
        CubeField.RelatesTo(new CubeRelationship(
          CubeRelationshipType.CONTINUED_IN, await continuedin.getKey()))
      ]));
      await cubeStore.addCube(nonconformingCube);

      // As requested, only the first MENTION is annotated and nothing else
      expect(annotationEngine.reverseRelationships.size).toEqual(1);
      expect(annotationEngine.getReverseRelationships(await muc1.getKey()).length).toEqual(1);
      const onlyReverseRelStored = annotationEngine.getReverseRelationships(await muc1.getKey())[0];
      expect(onlyReverseRelStored.type).toEqual(CubeRelationshipType.MENTION);
      expect(onlyReverseRelStored.remoteKey.equals(await nonconformingCube.getKey())).toBeTruthy();

      expect(annotationEngine.getReverseRelationships(await muc2.getKey()).length).toEqual(0);
      expect(annotationEngine.getReverseRelationships(await continuedin.getKey()).length).toEqual(0);
    });
  });
});
