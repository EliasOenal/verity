import { cciFamily } from "../../cci/cube/cciCube";
import { Cube } from "../../core/cube/cube";
import { CubeStore } from "../../core/cube/cubeStore";
import { CubeExplorerView } from "../view/cubeExplorerView";
import { VerityController } from "./verityController";

export class CubeExplorerController extends VerityController {

  constructor(
      readonly cubeStore: CubeStore,
      readonly maxCubes: number = 1000,
      public view: CubeExplorerView = new CubeExplorerView(),
  ){
    super();
  }

  /**
   * @param [search] If defined, only show Cubes whose hex-represented key
   * includes this string.
   */
  // TODO refined cube search (e.g. by date, fields present or even field content)
  // TODO pagination (we currently just abort after maxCubes and print a warning)
  // TODO sorting (e.g. by date)
  // TODO support non CCI cubes (including invalid / partial CCI cubes)
  redisplay() {
    const search: string = (this.view.renderedView.querySelector(
      ".verityCubeKeyFilter") as HTMLInputElement)?.value;

    this.view.clearAll();
    let displayed = 0, unparsable = 0, filtered = 0;
    for (const key of this.cubeStore.getAllKeystrings()) {
      if (search && !key.includes(search)) {
        filtered++;
        continue;  // skip non-matching
      }
      const cube: Cube = this.cubeStore.getCube(key, cciFamily);  // try to parse as CCI, but probably okay if it's not
      if (!cube) {
        unparsable++;
        continue;  // TODO error handling
      }
      displayed++;
      this.view.displayCube(key, cube);
      if (displayed >= this.maxCubes) {
        this.view.showBelowCubes(`Maximum of ${displayed} Cubes displayed, rest omittted. Consider narrower filter.`);
        break;
      }
    }
    this.view.displayStats(
      this.cubeStore.getNumberOfStoredCubes(), displayed, unparsable, filtered);
  }
}