import { Cube } from '../../src/model/cube';
import * as fp from '../../src/model/fieldProcessing';
import { CubeStore as CubeStore } from '../../src/model/cubeStore';
import sodium, { KeyPair } from 'libsodium-wrappers'
import { Field, FieldType, Fields } from '../../src/model/fieldProcessing';

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
    cubeStore = new CubeStore(false, false);
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
      if (!hash) throw new Error(`Hash is undefined for cube ${i}`);
      let binaryData = cubeStore.getCube(hash)?.getBinaryData();
      expect(hash).toBeInstanceOf(Buffer);
      if (hash) {
        expect(hash.length).toEqual(32);
        expect(cubeStore.getCube(hash).getBinaryData()).toEqual(binaryData);
      }
    });

    expect(cubeStore.getNumberOfStoredCubes()).toEqual(20);
  }, 30000);

  it('should add a cube from binary data', async () => {
    let hash = await cubeStore.addCube(validBinaryCube);
    expect(hash).toBeInstanceOf(Buffer);
    if (hash) {
      expect(hash.length).toEqual(32);
      expect(cubeStore.getCube(hash).getBinaryData()).toEqual(validBinaryCube);
    }
  }, 1000);

  it('should error when adding a cube with invalid binary data', async () => {
    let buffer = Buffer.alloc(1024);
    expect(await cubeStore.addCube(buffer)).toBeUndefined();
  }, 1000);

  it('should error when getting a cube with invalid hash', async () => {
    let buffer = Buffer.alloc(32);
    expect(cubeStore.getCube(buffer)).toBeUndefined();
  }, 1000);


  // TODO: Create own test suite for Fields and move this there
  it('correctly sets and retrieves a reply_to relationship field', async () => {
    const root: Cube = new Cube(); // will only be used as referenc
    const payloadfield: fp.Field = fp.Field.Payload(Buffer.alloc(200));
    root.setFields(payloadfield);

    const leaf: Cube = new Cube();

    leaf.setFields(new fp.Fields([
      payloadfield,
      fp.Field.RelatesTo(new fp.Relationship(
        fp.RelationshipType.REPLY_TO, (await root.getKey())))
    ]));

    const retrievedRel: fp.Relationship = leaf.getFields().getFirstRelationship();
    expect(retrievedRel.type).toEqual(fp.RelationshipType.REPLY_TO);
    expect(retrievedRel.remoteKey.toString('hex')).toEqual((await root.getKey()).toString('hex'));
  }, 1000);

  it('should update the initial MUC with the updated MUC.', async () => {
    // Generate a key pair for testing
    const keyPair = sodium.crypto_sign_keypair();
    const publicKey: Buffer = Buffer.from(keyPair.publicKey);
    const privateKey: Buffer = Buffer.from(keyPair.privateKey);

    // Define required MUC fields
    const fields = new Fields([
      new Field(FieldType.TYPE_SMART_CUBE | 0b00, 0, Buffer.alloc(0)),
      new Field(FieldType.TYPE_PUBLIC_KEY, 32, publicKey),
      new Field(FieldType.PADDING_NONCE, 909, Buffer.alloc(909)),
      new Field(FieldType.TYPE_SIGNATURE, 72, Buffer.alloc(72))
    ]);

    // Create first MUC with specified TLV fields
    const muc = new Cube();
    muc.setCryptoKeys(publicKey, privateKey);
    muc.setFields(fields);
    // set date to now unix time
    const date = Math.floor(Date.now() / 1000);
    // make sure date is ever so slightly dated
    muc.setDate(date - 1);
    const key = await muc.getKey();
    const info = await muc.getCubeInfo();
    expect(key).toBeDefined();
    expect(info).toBeDefined();
    cubeStore.addCube(muc);

    // Create second MUC with specified TLV fields
    const muc2 = new Cube();
    muc2.setCryptoKeys(publicKey, privateKey);
    muc2.setFields(fields);
    // Make sure date is ever so slightly newer
    muc2.setDate(date);
    const key2 = await muc2.getKey();
    const info2 = await muc2.getCubeInfo();
    expect(key2).toBeDefined();
    expect(info2).toBeDefined();
    await cubeStore.addCube(muc2);

    // Verify that the first MUC has been updated with the second MUC
    const retrievedMuc = cubeStore.getCube(key);
    expect(retrievedMuc).toBeDefined();
    expect(retrievedMuc?.getDate()).toEqual(date);
  }, 2000);
});