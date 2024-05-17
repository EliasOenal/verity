import { cciFamily } from "../../cci/cube/cciCube";
import type { Cube } from "../../core/cube/cube";
import type { CubeField } from "../../core/cube/cubeField";
import type { CubeStore } from "../../core/cube/cubeStore";
import { logger } from "../../core/logger";
import { getElementAboveByClassName } from "../helpers";
import { CubeExplorerView } from "../view/cubeExplorerView";
import { NavigationController } from "./navigationController";
import { ControllerContext, VerityController } from "./verityController";

export class CubeExplorerController extends VerityController {
  constructor(
      parent: ControllerContext,
      readonly maxCubes: number = 1000,
      public contentAreaView: CubeExplorerView = new CubeExplorerView(),
  ){
    super(parent);

    // set nav methods
    this.viewSelectMethods.set("all", this.selectAll);
  }

  //***
  // View selection methods
  //***

  selectAll(): Promise<void> {
    return this.redisplay();
  }

  //***
  // View assembly methods
  //***

  /**
   * @param [search] If defined, only show Cubes whose hex-represented key
   * includes this string.
   */
  // TODO refined cube search (e.g. by date, fields present or even field content)
  // TODO pagination (we currently just abort after maxCubes and print a warning)
  // TODO sorting (e.g. by date)
  // TODO support non CCI cubes (including invalid / partial CCI cubes)
  async redisplay(): Promise<void> {
    const search: string = (this.contentAreaView.renderedView.querySelector(
      ".verityCubeKeyFilter") as HTMLInputElement)?.value;

    this.contentAreaView.clearAll();
    let displayed = 0, unparsable = 0, filtered = 0;
    for await (const key of this.cubeStore.getAllKeys(true)) {
      if (search && !key.includes(search)) {
        filtered++;
        continue;  // skip non-matching
      }
      const cube: Cube = await this.cubeStore.getCube(key);  // try to parse as CCI, but probably okay if it's not
      if (!cube) {
        unparsable++;
        continue;  // TODO error handling
      }
      displayed++;
      this.contentAreaView.displayCube(key as string, cube);
      if (displayed >= this.maxCubes) {
        this.contentAreaView.showBelowCubes(`Maximum of ${displayed} Cubes displayed, rest omittted. Consider narrower filter.`);
        break;
      }
    }
    this.contentAreaView.displayStats(
      await this.cubeStore.getNumberOfStoredCubes(), displayed, unparsable, filtered);
  }

  //***
  // Navigation methods
  //***

  async changeEncoding(select: HTMLSelectElement) {
    const cubeLi: HTMLLIElement =
      getElementAboveByClassName(select, "verityCube") as HTMLLIElement;
    const cubeKeyString = cubeLi.getAttribute("data-cubekey");
    const detailsTable: HTMLTableElement = getElementAboveByClassName(select, "veritySchematicFieldDetails") as HTMLTableElement;
    const fieldIndex: number = Number.parseInt(detailsTable?.getAttribute?.("data-fieldindex"));
    if (!cubeLi || !detailsTable || !cubeKeyString || isNaN(fieldIndex)) {
      logger.warn("CubeExplorerController.changeEncoding(): Could not find my elems and attrs, did you mess with my DOM elements?!");
      return;
    }
    const cube: Cube = await this.cubeStore.getCube(cubeKeyString);
    if (!cube) {
      logger.warn("CubeExplorerController.changeEncoding(): could not find Cube " + cubeKeyString);
      return;
    }
    let field: CubeField = undefined;
    try { field = cube.fields.all[fieldIndex]; } catch(err) {}
    if (!field) {
      logger.warn(`CubeExplorerController.changeEncoding(): could not find field no ${fieldIndex} in Cube ${cubeKeyString}`);
      return;

    }
    this.contentAreaView.setDecodedFieldContent(field, select.selectedIndex, detailsTable);
  }
}

NavigationController.RegisterController("cubeExplorer", CubeExplorerController);
