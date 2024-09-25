import { cciCube } from "../../../src/cci/cube/cciCube";
import { cciFieldLength, cciFieldType } from "../../../src/cci/cube/cciCube.definitions";
import { cciField } from "../../../src/cci/cube/cciField";
import { CubeFieldType, CubeType, HasNotify, HasSignature } from "../../../src/core/cube/cube.definitions";
import { enumNums } from "../../../src/core/helpers/misc";
import { NetConstants } from "../../../src/core/networking/networkDefinitions";

import sodium from 'libsodium-wrappers-sumo'

import pkg from 'js-sha3';  // strange standards compliant syntax for importing
import { CubeField } from "../../../src/core/cube/cubeField";
import { typeFromBinary } from "../../../src/core/cube/cubeUtil";
const { sha3_256 } = pkg;   // commonJS modules as if they were ES6 modules

const reducedDifficulty = 0;

describe('cciCube', () => {
  let commonKeyPair: sodium.KeyPair;

  beforeAll(async () => {
    await sodium.ready;
    commonKeyPair = sodium.crypto_sign_keypair();
  });

  describe('method padUp()', () => {
    // Note: This was moved here from the core tests, but as of the time of
    // writiting of this comment the padUp() method was still implemented in Core.
    it('Should not add padding if not required', async() => {
      // Create a Cube with fields whose total length is equal to the cube size
      const cube = cciCube.Frozen({
        fields: cciField.Payload("His cubus plenus est"),
        requiredDifficulty: reducedDifficulty,
      });
      const freeSpace = NetConstants.CUBE_SIZE - cube.getFieldLength();
      const plHl = cube.fieldParser.getFieldHeaderLength(cciFieldType.PAYLOAD);
      cube.insertFieldBeforeBackPositionals(cciField.Payload(
        Buffer.alloc(freeSpace - plHl)));  // cube now all filled up
      expect(cube.getFieldLength()).toEqual(NetConstants.CUBE_SIZE);

      const fieldCountBeforePadding = cube.fieldCount;
      const paddingAdded: boolean = cube.padUp();
      const fieldCountAfterPadding = cube.fieldCount;

      expect(paddingAdded).toBe(false);
      expect(fieldCountAfterPadding).toEqual(fieldCountBeforePadding);
      expect(cube.getFieldLength()).toEqual(NetConstants.CUBE_SIZE);
    });

    it('Should add padding starting with 0x00 if required', async() => {
      // Create a Cube with fields whose total length is equal to the cube size
      const payload = cciField.Payload(
        "Hic cubus nimis parvus, ideo supplendus est.");
      const cube = cciCube.Frozen({
        fields: payload, requiredDifficulty: reducedDifficulty});

      const fieldCountBeforePadding = cube.fieldCount;
      const paddingAdded = cube.padUp();
      const fieldCountAfterPadding = cube.fieldCount;

      expect(paddingAdded).toBe(true);
      expect(fieldCountAfterPadding).toBeGreaterThan(fieldCountBeforePadding);
      expect(cube.getFieldLength()).toEqual(NetConstants.CUBE_SIZE);

      // now get binary data and ensure padding starts with 0x00
      const binaryCube: Buffer = await cube.getBinaryData();
      const expectEndMarkerAt =
        payload.start +
        cube.fieldParser.getFieldHeaderLength(cciFieldType.PAYLOAD) +
        payload.length;
      expect(binaryCube[expectEndMarkerAt]).toEqual(0x00);
    });

    it('should remove extra padding if necessary', async() => {
      const overlyPadded: cciCube = cciCube.Frozen({
        requiredDifficulty: reducedDifficulty,
        fields: [
          cciField.Payload("Hic cubus nimis multum impluvium continet."),
        ]
      });
      overlyPadded.insertFieldBeforeBackPositionals(
        cciField.Padding(2000)  // are you crazy?!
      );
      const binaryCube: Buffer = await overlyPadded.getBinaryData();
      expect(binaryCube).toHaveLength(NetConstants.CUBE_SIZE);
    });
  });  // describe padUp()

  describe('tests by Cube type', () => {
    describe('compilation and decompilation by Cube type', () => {
      enumNums(CubeType).forEach((type) => {  // perform the tests for every CubeType
        it(`should compile and decompile ${CubeType[type]} Cubes correctly`, async () => {
          // Craft a randomized content string. We will later test if it's
          // still correct after compiling and decompiling.
          const randomNumber = Math.floor(Math.random() * 100000);
          const contentString = `Cubus generis ${CubeType[type]} sum. Numerus fortuitus meus est ${randomNumber}.`;
          const randomNotifyNumber = Math.floor(Math.random() * 255);

          // prepare some fields: One PAYLOAD...
          const incompleteFieldset: cciField[] =
            [cciField.Payload(contentString)];
          // ... plus a Notify field if this is a Notify type ...
          if (HasNotify[type]) incompleteFieldset.push(
            cciField.Notify(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, randomNotifyNumber)));

          // sculpt Cube
          const cube: cciCube = cciCube.Create(type, {
            fields: incompleteFieldset,
            requiredDifficulty: reducedDifficulty,
            publicKey: commonKeyPair.publicKey,    // will be ignored for
            privateKey: commonKeyPair.privateKey,  // non-signed Cubes
          });
          expect(cube.cubeType).toBe(type);

          // compile Cube
          const binaryData = await cube.getBinaryData();

          expect(typeFromBinary(binaryData)).toBe(type);

          // verify hash calculation is correct (has is always calculated from
          // the entire binary data, even though key generation differs by Cube type)
          const expectedHash: Buffer = Buffer.from(sha3_256.arrayBuffer(binaryData));
          expect(await cube.getHash()).toEqual(expectedHash);

          // verify key calculation is correct
          const key = await cube.getKey();
          // for signed Cubes, the key is the public key
          if (HasSignature[type]) expect(key).toEqual(Buffer.from(commonKeyPair.publicKey));
          else if (type === CubeType.FROZEN || type === CubeType.FROZEN_NOTIFY) {
            // for frozen Cubes, the key is the full hash
            expect(key).toEqual(expectedHash);
          } else if (type === CubeType.PIC || type === CubeType.PIC_NOTIFY) {
            // for PICs, the key is the hash excluding the DATE and NONCE fields
            const keyHashLength =
              cciFieldLength[cciFieldType.TYPE] +
              cciFieldLength[cciFieldType.PIC_RAWCONTENT];  // we don't actually use RAWCONTENT fields in CCI, but the length calculation is still correct
            const keyHashableBinaryData = binaryData.subarray(0, keyHashLength);
            const expectedKey = Buffer.from(sha3_256.arrayBuffer(keyHashableBinaryData));
            expect(key).toEqual(expectedKey);
          }

          // decompile the Cube and check if the content is still the same
          const recontructed: cciCube = new cciCube(binaryData);
          expect(recontructed.cubeType).toBe(type);
          expect(recontructed.getFirstField(cciFieldType.PAYLOAD).valueString).
            toEqual(contentString);
          if (HasNotify[type]) {
            expect(recontructed.getFirstField(CubeFieldType.NOTIFY).value[0]).toEqual(randomNotifyNumber);
          }
          // double-check hash is still correct
          expect(await recontructed.getHash()).toEqual(expectedHash);
        }, 3000);
      });  // for each Cube type
    });  // basic compilation and decompilation by Cube type
  });  // tests by Cube type
});
