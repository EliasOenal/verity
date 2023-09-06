import { Cube } from "../../src/model/cube";
import { CubeField, CubeFields, CubeRelationship, CubeRelationshipType } from "../../src/model/cubeFields";
import { CubeStore } from "../../src/model/cubeStore";
import { AnnotationEngine } from "../../src/viewmodel/annotationEngine";
import { ZwAnnotationEngine } from "../../src/viewmodel/zwAnnotationEngine";
import { makePost } from "../../src/viewmodel/zwCubes"

describe('ZwAnnotationEngine', () => {
  let cubeStore: CubeStore;
  let annotationEngine: ZwAnnotationEngine;

  beforeEach(() => {
    cubeStore = new CubeStore(false);
    annotationEngine = new ZwAnnotationEngine(cubeStore);
  }, 1000);

  it('should mark a single root cube as displayable', async () => {
    const root: Cube = makePost("Mein kleiner grüner Kaktus");

    const callback = jest.fn();
    annotationEngine.on('cubeDisplayable', (hash) => callback(hash)) // list cubes

    await cubeStore.addCube(root);

    expect(callback.mock.calls).toEqual([
      [await root.getKey()],
    ]);
  }, 5000);

  it('should mark a cube and a reply received in sync as displayable', async () => {
    const root: Cube = makePost("Mein kleiner grüner Kaktus");
    const leaf: Cube = makePost("steht draußen am Balkon", await root.getKey());

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
    const root: Cube = makePost("Mein kleiner grüner Kaktus");
    const leaf: Cube = makePost("steht draußen am Balkon", await root.getKey());

    const callback = jest.fn();
    annotationEngine.on('cubeDisplayable', (hash) => callback(hash));

    await cubeStore.addCube(leaf);
    expect(callback).not.toHaveBeenCalled();
  }, 5000);

  it('should mark replies as displayable only once all preceding posts has been received', async () => {
    const root: Cube = makePost("Mein kleiner grüner Kaktus");
    const intermediate: Cube = makePost("steht draußen am Balkon", await root.getKey());
    const leaf: Cube = makePost("hollari, hollari, hollaroooo", await intermediate.getKey());

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