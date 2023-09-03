import { AnnotationEngine } from '../../src/viewmodel/annotationEngine';
import { Cube } from '../../src/model/cube';
import { CubeStore as CubeStore } from '../../src/model/cubeStore';
import { Field, Fields, Relationship, RelationshipType } from '../../src/model/fields';

describe('annotationEngine', () => {
  let cubeStore: CubeStore;
  let annotationEngine: AnnotationEngine;

  beforeEach(() => {
    cubeStore = new CubeStore(false);
    annotationEngine = new AnnotationEngine(cubeStore);
  }, 1000);


  // TODO: move displayability logic somewhere else
  it('should mark a cube and a reply received in sync as displayable', async () => {
    const root: Cube = new Cube();
    const payloadfield: Field = Field.Payload(Buffer.alloc(200));
    root.setFields(payloadfield);

    const leaf: Cube = new Cube();
    leaf.setFields(new Fields([
      payloadfield,
      Field.RelatesTo(new Relationship(
        RelationshipType.REPLY_TO, await root.getKey()))
    ]));

    const callback = jest.fn();
    annotationEngine.on('cubeDisplayable', (hash) => callback(hash)) // list cubes

    cubeStore.addCube(root);
    cubeStore.addCube(leaf);

    expect(callback.mock.calls).toEqual([
      [await root.getKey()],
      [await leaf.getKey()]
    ]);
  }, 5000);

  it('should not mark replies as displayable when the original post is unavailable', async () => {
    const root: Cube = new Cube(); // will NOT be added
    const payloadfield: Field = Field.Payload(Buffer.alloc(200));
    root.setFields(payloadfield);

    const leaf: Cube = new Cube();
    leaf.setFields(new Fields([
      payloadfield,
      Field.RelatesTo(new Relationship(
        RelationshipType.REPLY_TO, await root.getKey()))
    ]));

    const callback = jest.fn();
    annotationEngine.on('cubeDisplayable', (hash) => callback(hash));

    cubeStore.addCube(leaf);
    expect(callback).not.toHaveBeenCalled();
  }, 5000);

  it('should mark replies as displayable only once all preceding posts has been received', async () => {
    const root: Cube = new Cube();
    const payloadfield: Field = Field.Payload(Buffer.alloc(200));
    root.setFields(payloadfield);

    const intermediate: Cube = new Cube();
    intermediate.setFields(new Fields([
      Field.RelatesTo(new Relationship(
        RelationshipType.REPLY_TO, await root.getKey())),
      payloadfield,  // let's shift the payload field around a bit for good measure :)
    ]));

    const leaf: Cube = new Cube();
    leaf.setFields(new Fields([
      payloadfield,
      Field.RelatesTo(new Relationship(
        RelationshipType.REPLY_TO, await intermediate.getKey()))
    ]));

    const callback = jest.fn();
    annotationEngine.on('cubeDisplayable', (hash) => callback(hash)) // list cubes

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
