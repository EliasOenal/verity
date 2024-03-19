import { Cube } from "../../core/cube/cube";
import { cciCube } from "./cciCube";

export function isCci(cube: Cube): boolean {
  if (cube instanceof cciCube && cube.assertCci()) return true;
  else return false;
}

export function ensureCci(cube: Cube): cciCube {
  if (isCci(cube)) return cube as cciCube;
  else return undefined;
}
