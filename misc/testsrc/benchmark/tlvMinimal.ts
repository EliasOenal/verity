import { Cube } from "../../../src/core/cube/cube";
import { CubeField, CubeFieldType, CubeFields } from "../../../src/core/cube/cubeFields";

async function prepareBinaryCube() {
  const cube: Cube = new Cube();
  const fields = new CubeFields();
  cube.setFields(fields);
  const bin: Buffer = await cube.getBinaryData();
  return bin;
}

function runTlvTest(bin: Buffer, rounds: number = 1e5) {
  for (let i=0; i<rounds; i++) {
    const restored: Cube = new Cube(bin);
    if (restored.getFields().getFieldCount() != 3) throw new Error("?!?!?!?!");
  }
}

async function main() {
  const bin = await prepareBinaryCube();
  runTlvTest(bin);
}

main();