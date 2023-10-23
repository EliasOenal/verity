import { Cube } from "../core/cube/cube";
import { CubeField, CubeFieldType, CubeFields } from "../core/cube/cubeFields";
import * as CubeUtil from '../core/cube/cubeUtil';

async function prepareBinaryCube() {
  const cube: Cube = new Cube();
  const fields = new CubeFields();
  cube.setFields(fields);
  const bin: Buffer = await cube.getBinaryData();
  const hash: Buffer = await cube.getHash();
  return {bin, hash};
}

function runHashTest(bin: Buffer, hash: Buffer, rounds: number = 1e5) {
  for (let i=0; i<rounds; i++) {
    const calculated = CubeUtil.calculateHash(bin);
    if (!calculated.equals(hash)) throw new Error("?!?!?!?!?!?");
  }
}

async function main() {
  const {bin, hash} = await prepareBinaryCube();
  runHashTest(bin, hash);
}

main();