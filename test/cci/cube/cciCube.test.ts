import { cciCube } from "../../../src/cci/cube/cciCube";
import { cciFieldType } from "../../../src/cci/cube/cciCube.definitions";
import { cciField } from "../../../src/cci/cube/cciField";
import { NetConstants } from "../../../src/core/networking/networkDefinitions";

const reducedDifficulty = 0;

describe('cciCube', () => {
  describe('method padUp()', () => {
    // Note: This was moved here from the core tests, but as of the time of
    // writiting of this comment the padUp() method was still implemented in Core.
    it('Should not add padding if not required', async() => {
      // Create a Cube with fields whose total length is equal to the cube size
      const cube = cciCube.Frozen({
        fields: cciField.Payload("His cubus plenus est"),
        requiredDifficulty: reducedDifficulty,
      });
      const freeSpace = NetConstants.CUBE_SIZE - cube.fields.getByteLength();
      const plHl = cube.fieldParser.getFieldHeaderLength(cciFieldType.PAYLOAD);
      cube.fields.insertFieldBeforeBackPositionals(cciField.Payload(
        Buffer.alloc(freeSpace - plHl)));  // cube now all filled up
      expect(cube.fields.getByteLength()).toEqual(NetConstants.CUBE_SIZE);

      const fieldCountBeforePadding = cube.fields.all.length;
      const paddingAdded: boolean = cube.padUp();
      const fieldCountAfterPadding = cube.fields.all.length;

      expect(paddingAdded).toBe(false);
      expect(fieldCountAfterPadding).toEqual(fieldCountBeforePadding);
      expect(cube.fields.getByteLength()).toEqual(NetConstants.CUBE_SIZE);
    });

    it('Should add padding starting with 0x00 if required', async() => {
      // Create a Cube with fields whose total length is equal to the cube size
      const payload = cciField.Payload(
        "Hic cubus nimis parvus, ideo supplendus est.");
      const cube = cciCube.Frozen({
        fields: payload, requiredDifficulty: reducedDifficulty});

      const fieldCountBeforePadding = cube.fields.all.length;
      const paddingAdded = cube.padUp();
      const fieldCountAfterPadding = cube.fields.all.length;

      expect(paddingAdded).toBe(true);
      expect(fieldCountAfterPadding).toBeGreaterThan(fieldCountBeforePadding);
      expect(cube.fields.getByteLength()).toEqual(NetConstants.CUBE_SIZE);

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
      overlyPadded.fields.insertFieldBeforeBackPositionals(
        cciField.Padding(2000)  // are you crazy?!
      );
      const binaryCube: Buffer = await overlyPadded.getBinaryData();
      expect(binaryCube).toHaveLength(NetConstants.CUBE_SIZE);
    });
  });  // describe padUp()
});
