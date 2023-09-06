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
  }, 1000);

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

  it('should mark a single root cube as displayable', async () => {
    const root: Cube = new Cube();
    root.setFields(CubeField.Payload("Mein kleiner grüner Kaktus"));

    const callback = jest.fn();
    annotationEngine.on('cubeDisplayable', (hash) => callback(hash)) // list cubes

    await cubeStore.addCube(root);

    expect(callback.mock.calls).toEqual([
      [await root.getKey()],
    ]);
  }, 5000);

  it('should mark a cube and a reply received in sync as displayable', async () => {
    const root: Cube = new Cube();
    const payloadfield: CubeField = CubeField.Payload(Buffer.alloc(200));
    root.setFields(payloadfield);

    const leaf: Cube = new Cube();
    leaf.setFields(new CubeFields([
      payloadfield,
      CubeField.RelatesTo(new CubeRelationship(
        CubeRelationshipType.REPLY_TO, await root.getKey()))
    ]));

    const callback = jest.fn();
    annotationEngine.on('cubeDisplayable', (hash) => callback(hash)) // list cubes

    await cubeStore.addCube(root);
    await cubeStore.addCube(leaf);

    expect(callback.mock.calls).toEqual([
      [await root.getKey()],
      [await leaf.getKey()]
    ]);
  }, 5000);

  it('should not mark replies as displayable when the original post is unavailable', async () => {
    const root: Cube = new Cube(); // will NOT be added
    const payloadfield: CubeField = CubeField.Payload(Buffer.alloc(200));
    root.setFields(payloadfield);

    const leaf: Cube = new Cube();
    leaf.setFields(new CubeFields([
      payloadfield,
      CubeField.RelatesTo(new CubeRelationship(
        CubeRelationshipType.REPLY_TO, await root.getKey()))
    ]));

    const callback = jest.fn();
    annotationEngine.on('cubeDisplayable', (hash) => callback(hash));

    await cubeStore.addCube(leaf);
    expect(callback).not.toHaveBeenCalled();
  }, 5000);

  it('should mark replies as displayable only once all preceding posts has been received', async () => {
    const root: Cube = new Cube();
    const payloadfield: CubeField = CubeField.Payload(Buffer.alloc(200));
    root.setFields(payloadfield);

    const intermediate: Cube = new Cube();
    intermediate.setFields(new CubeFields([
      CubeField.RelatesTo(new CubeRelationship(
        CubeRelationshipType.REPLY_TO, await root.getKey())),
      payloadfield,  // let's shift the payload field around a bit for good measure :)
    ]));

    const leaf: Cube = new Cube();
    leaf.setFields(new CubeFields([
      payloadfield,
      CubeField.RelatesTo(new CubeRelationship(
        CubeRelationshipType.REPLY_TO, await intermediate.getKey()))
    ]));

    const callback = jest.fn();
    annotationEngine.on('cubeDisplayable', (hash) => callback(hash)) // list cubes

    // add in reverse order:
    await cubeStore.addCube(leaf);
    await cubeStore.addCube(intermediate);
    await cubeStore.addCube(root);

    expect(callback.mock.calls).toEqual([
      [await root.getKey()],
      [await intermediate.getKey()],
      [await leaf.getKey()]
    ]);
  }, 5000);
});
