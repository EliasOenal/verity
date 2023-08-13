import exp from 'constants';
import { Cube } from './cube';
import { logger } from './logger';
import * as fp from './fieldProcessing';
import { CubeStore as CubeStore } from './cubeStore';

describe('cubeStore', () => {
  let cubeStore: CubeStore;
  const validBinaryCube = Buffer.from([
    // Protocol Version and Reserved Bits (1 byte)
    0b00000000,

    // Date (5 bytes)
    0x00, 0x00, 0x00, 0x00, 0x00,

    // Payload TLV field
    0x04, // Type: Payload
    0x0A,       // Length: 10 bytes little endian
    0x48, 0x65, 0x6C, 0x6C, 0x6F, 0x2C, 0x20, 0x77, 0x6F, 0x72, // Value: "Hello, wor"

    // Padding TLV field (remaining bytes to fill 1024)
    0x00 | 0b11, // Type: Padding
    0xEC,       // Length: 1004 bytes
    0x00, 0x00, 0x37, 0x4D, // Nonce passing challenge requirement
    // Padding data (up to index 1023) - For demonstration, all zeros
    ...Array.from({ length: 1000 }, () => 0x00),
  ])

  beforeEach(() => {
    cubeStore = new CubeStore(false, true);
  }, 1000);

  it('should add 20 cubes to the storage and get them back', async () => {
    const promises = [];
    for (let i = 0; i < 20; i++) {
      let cube = new Cube();
      cube.setDate(i);
      promises.push(cubeStore.addCube(cube));
    }
    
    const hashes = await Promise.all(promises);
    
    hashes.forEach((hash, i) => {
      if(!hash) throw new Error(`Hash is undefined for cube ${i}`);
      let binaryData = cubeStore.getCube(hash)?.getBinaryData();
      expect(typeof hash).toEqual('string');
      if (hash) {
        expect(hash.length).toEqual(64);
        expect(cubeStore.getCube(hash)?.getBinaryData()).toEqual(binaryData);
      }
    });
    
    expect(cubeStore.getNumberOfStoredCubes()).toEqual(20);
  }, 30000);

  it('should add a cube from binary data', async () => {
    let hash = await cubeStore.addCube(validBinaryCube);
    expect(typeof hash).toEqual('string');
    if (hash) {
      expect(hash.length).toEqual(64);
      expect(cubeStore.getCube(hash).getBinaryData()).toEqual(validBinaryCube);
    }
  }, 1000);

  it('should error when adding a cube with invalid binary data', async () => {
    let buffer = Buffer.alloc(1024);
    expect(await cubeStore.addCube(buffer)).toBeUndefined();
  }, 1000);

  it('should error when getting a cube with invalid hash', async () => {
    let buffer = Buffer.alloc(32);
    expect(cubeStore.getCube(buffer.toString('hex'))).toBeUndefined();
  }, 1000);



  // TODO: Create own test suite for Fields and move this there
  it('correctly sets and retrieves a reply_to relationship field', async () => {
    const root: Cube = new Cube(); // will only be used as referenc
    const payloadfield: fp.Field = fp.Field.Payload(Buffer.alloc(200));
    root.setFields([payloadfield]);

    const leaf: Cube = new Cube();

    leaf.setFields([
      payloadfield,
      fp.Field.RelatesTo(new fp.Relationship(
        fp.RelationshipType.REPLY_TO, (await root.getKey()).toString('hex')))
    ]);

    const retrievedRel: fp.Relationship = leaf.getFields().getFirstRelationship();
    expect(retrievedRel.type).toEqual(fp.RelationshipType.REPLY_TO);
    expect(retrievedRel.remoteKey).toEqual((await root.getKey()).toString('hex'));
  }, 1000);



  // TODO: move displayability logic somewhere else
  it('should mark a cube and a reply received in sync as displayable', async () => {
    const root: Cube = new Cube();
    const payloadfield: fp.Field = fp.Field.Payload(Buffer.alloc(200));
    root.setFields([payloadfield]);

    const leaf: Cube = new Cube();
    leaf.setFields([
      payloadfield,
      fp.Field.RelatesTo(new fp.Relationship(
        fp.RelationshipType.REPLY_TO, (await root.getKey()).toString('hex')))
    ]);

    const callback = jest.fn();
    cubeStore.on('cubeDisplayable', (hash) => callback(hash)) // list cubes

    cubeStore.addCube(root);
    cubeStore.addCube(leaf);

    expect(callback.mock.calls).toEqual([
      [(await root.getKey()).toString('hex')],
      [(await leaf.getKey()).toString('hex')]
    ]);
  }, 2000);

  it('should not mark replies as displayable when the original post is unavailable', async () => {
    const root: Cube = new Cube(); // will NOT be added
    const payloadfield: fp.Field = fp.Field.Payload(Buffer.alloc(200));
    root.setFields([payloadfield]);

    const leaf: Cube = new Cube();
    leaf.setFields([
      payloadfield,
      fp.Field.RelatesTo(new fp.Relationship(
        fp.RelationshipType.REPLY_TO, (await root.getKey()).toString('hex')))
    ]);

    const callback = jest.fn();
    cubeStore.on('cubeDisplayable', (hash) => callback(hash));

    cubeStore.addCube(leaf);
    expect(callback).not.toHaveBeenCalled();
    logger.trace("TEST: mock calls: " + callback.mock.calls);
  }, 2000);

  it('should mark replies as displayable only once all preceding posts has been received', async() => {
    const root: Cube = new Cube();
    const payloadfield: fp.Field = fp.Field.Payload(Buffer.alloc(200));
    root.setFields([payloadfield]);

    const intermediate: Cube = new Cube();
    intermediate.setFields([
      fp.Field.RelatesTo(new fp.Relationship(
        fp.RelationshipType.REPLY_TO, (await root.getKey()).toString('hex'))),
      payloadfield,  // let's shift the payload field around a bit for good measure :)
    ]);

    const leaf: Cube = new Cube();
    leaf.setFields([
      payloadfield,
      fp.Field.RelatesTo(new fp.Relationship(
        fp.RelationshipType.REPLY_TO, (await intermediate.getKey()).toString('hex')))
    ]);

    const callback = jest.fn();
    cubeStore.on('cubeDisplayable', (hash) => callback(hash)) // list cubes

    logger.trace(`TEST: root ID ${(await root.getKey()).toString('hex')}`);
    logger.trace(`TEST: intermediate ID ${(await intermediate.getKey()).toString('hex')}`);
    logger.trace(`TEST: leaf ID ${(await leaf.getKey()).toString('hex')}`);

    // add in reverse order:
    cubeStore.addCube(leaf);
    cubeStore.addCube(intermediate);
    cubeStore.addCube(root);

    logger.trace("mock calls received: " + callback.mock.calls);

    expect(callback.mock.calls).toEqual([
      [(await root.getKey()).toString('hex')],
      [(await intermediate.getKey()).toString('hex')],
      [(await leaf.getKey()).toString('hex')]
    ]);
  }, 2000);
});