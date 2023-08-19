import { AnnotationEngine } from './annotationEngine';
import { Cube } from './cube';
import { logger } from './logger';
import * as fp from './fieldProcessing';
import { CubeStore as CubeStore } from './cubeStore';
import { Fields } from './fieldProcessing';

describe('annotationEngine', () => {
  let cubeStore: CubeStore;

  beforeEach(() => {
    cubeStore = new CubeStore(false, true);
  }, 1000);


  // TODO: move displayability logic somewhere else
  it('should mark a cube and a reply received in sync as displayable', async () => {
    const root: Cube = new Cube();
    const payloadfield: fp.Field = fp.Field.Payload(Buffer.alloc(200));
    root.setFields(payloadfield);

    const leaf: Cube = new Cube();
    leaf.setFields(new Fields([
      payloadfield,
      fp.Field.RelatesTo(new fp.Relationship(
        fp.RelationshipType.REPLY_TO, await root.getKey()))
    ]));

    const callback = jest.fn();
    cubeStore.annotationEngine.on('cubeDisplayable', (hash) => callback(hash)) // list cubes

    cubeStore.addCube(root);
    cubeStore.addCube(leaf);

    expect(callback.mock.calls).toEqual([
      [await root.getKey()],
      [await leaf.getKey()]
    ]);
  }, 5000);

  it('should not mark replies as displayable when the original post is unavailable', async () => {
    const root: Cube = new Cube(); // will NOT be added
    const payloadfield: fp.Field = fp.Field.Payload(Buffer.alloc(200));
    root.setFields(payloadfield);

    const leaf: Cube = new Cube();
    leaf.setFields(new Fields([
      payloadfield,
      fp.Field.RelatesTo(new fp.Relationship(
        fp.RelationshipType.REPLY_TO, await root.getKey()))
    ]));

    const callback = jest.fn();
    cubeStore.annotationEngine.on('cubeDisplayable', (hash) => callback(hash));

    cubeStore.addCube(leaf);
    expect(callback).not.toHaveBeenCalled();
  }, 5000);

  it('should mark replies as displayable only once all preceding posts has been received', async () => {
    const root: Cube = new Cube();
    const payloadfield: fp.Field = fp.Field.Payload(Buffer.alloc(200));
    root.setFields(payloadfield);

    const intermediate: Cube = new Cube();
    intermediate.setFields(new Fields([
      fp.Field.RelatesTo(new fp.Relationship(
        fp.RelationshipType.REPLY_TO, await root.getKey())),
      payloadfield,  // let's shift the payload field around a bit for good measure :)
    ]));

    const leaf: Cube = new Cube();
    leaf.setFields(new Fields([
      payloadfield,
      fp.Field.RelatesTo(new fp.Relationship(
        fp.RelationshipType.REPLY_TO, await intermediate.getKey()))
    ]));

    const callback = jest.fn();
    cubeStore.annotationEngine.on('cubeDisplayable', (hash) => callback(hash)) // list cubes

    // add in reverse order:
    cubeStore.addCube(leaf);
    cubeStore.addCube(intermediate);
    cubeStore.addCube(root);

    expect(callback.mock.calls).toEqual([
      [await root.getKey()],
      [await intermediate.getKey()],
      [await leaf.getKey()]
    ]);
  }, 5000);
});
