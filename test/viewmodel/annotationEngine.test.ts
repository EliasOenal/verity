import { AnnotationEngine } from '../../src/viewmodel/annotationEngine';
import { Cube } from '../../src/model/cube';
import { CubeStore as CubeStore } from '../../src/model/cubeStore';
import { CubeField, CubeFields, CubeRelationship, CubeRelationshipType } from '../../src/model/cubeFields';
import { logger } from '../../src/model/logger';

describe('annotationEngine', () => {
  let cubeStore: CubeStore;
  let annotationEngine: AnnotationEngine;

  beforeEach(() => {
    cubeStore = new CubeStore(false);
    annotationEngine = new AnnotationEngine(cubeStore);
  }, 3000);

  it('correctly creates a reverse relationship', async () => {
    const referrer = new Cube();
    const referee = new Cube();

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
