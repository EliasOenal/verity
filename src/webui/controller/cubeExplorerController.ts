import { cciCube } from "../../cci/cciCube";
import { cciFieldParsers } from "../../cci/cciFields";
import { Cube } from "../../core/cube/cube";
import { CubeStore } from "../../core/cube/cubeStore";
import { CubeExplorerView } from "../view/cubeExplorerView";
import { VerityController } from "../webUiDefinitions";

export class CubeExplorerController extends VerityController {
  declare view: CubeExplorerView;

  constructor(
      readonly cubeStore: CubeStore,
      readonly maxCubes: number = 1000,
      view = new CubeExplorerView(),
  ){
    super(view);
  }

  /**
   * @param [search] If defined, only show Cubes whose hex-represented key
   * includes this string.
   */
  // TODO limit max cubes shown
  // TODO support non CCI cubes (including invalid / partial CCI cubes)
  redisplay(search: string = undefined) {
    this.view.clearAll();
    for (const key of this.cubeStore.getAllKeystrings()) {
      if (search && !key.includes(search)) continue;  // skip non-matching
      const cube: cciCube = this.cubeStore.getCube(key, cciFieldParsers, cciCube) as cciCube;
      if (!cube) continue;  // TODO error handling
      this.view.displayCube(key, cube);
    }
  }
}