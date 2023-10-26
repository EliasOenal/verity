import { Cube } from "../../../src/core/cube/cube";
import { CubeField, CubeFieldType, CubeFields } from "../../../src/core/cube/cubeFields";

async function prepareBinaryCube() {
  const cube: Cube = new Cube();
  const fields = new CubeFields();
  for (let i=0; i<506; i++) {
    fields.appendField(new CubeField(
      CubeFieldType.PAYLOAD, 0, Buffer.alloc(0)
    ));
  }
  cube.setFields(fields);
  const bin: Buffer = await cube.getBinaryData();
  return bin;
}

function runTlvTest(bin: Buffer, rounds: number = 1e5) {
  for (let i=0; i<rounds; i++) {
    const restored: Cube = new Cube(bin);
    if (restored.getFields().getFieldCount() != 509) throw new Error(restored.getFields().getFieldCount().toString());
  }
}

async function main() {
  const bin = await prepareBinaryCube();
  runTlvTest(bin);
}

main();