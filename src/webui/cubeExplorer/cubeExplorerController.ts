import { cciFamily } from "../../cci/cube/cciCube";
import { rawCubeFamily, type Cube } from "../../core/cube/cube";
import type { CubeField } from "../../core/cube/cubeField";
import type { CubeStore } from "../../core/cube/cubeStore";
import { logger } from "../../core/logger";
import { getElementAboveByClassName } from "../helpers";
import { CubeExplorerView } from "./cubeExplorerView";
import { NavigationController } from "../navigation/navigationController";
import { ControllerContext, VerityController } from "../verityController";
import type { CubeKey } from "../../core/cube/cubeDefinitions";

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
    // read and parse search filters:
    // Cube Key
    const keySearch: string = (this.contentAreaView.renderedView.querySelector(
      ".verityCubeKeyFilter") as HTMLInputElement)?.value;
    // Sculpt date
    const dateFromInput: string = (this.contentAreaView.renderedView.querySelector(
      ".verityCubeDateFrom") as HTMLInputElement)?.value;
    let dateFrom: number = (new Date(dateFromInput)).getTime() / 1000;
    if (Number.isNaN(dateFrom)) dateFrom = Number.MIN_SAFE_INTEGER;
    const dateToInput: string = (this.contentAreaView.renderedView.querySelector(
      ".verityCubeDateTo") as HTMLInputElement)?.value;
    let dateTo: number = (new Date(dateToInput)).getTime() / 1000;
    if (Number.isNaN(dateTo)) dateTo = Number.MAX_SAFE_INTEGER;
    // String content
    const contentSearch: string = (this.contentAreaView.renderedView.querySelector(
      ".verityCubeContentFilter") as HTMLInputElement)?.value;

    this.contentAreaView.clearAll();
    let displayed = 0, unparsable = 0, filtered = 0;
    for await (const key of this.cubeStore.getAllKeys(true)) {
      // Apply key filter before even activating this Cube
      if (keySearch && !key.includes(keySearch)) {
        filtered++;
        continue;  // skip non-matching
      }
      // fetch Cube
      const cube: Cube = await this.getCube(key);
      if (cube === undefined) {  // unparseable, giving up
        unparsable++;
        continue;
      }
      // apply further filters
      if (cube.getDate() < dateFrom || cube.getDate() > dateTo ||
          contentSearch.length>0 &&  // raw content filter
            !cube.getBinaryDataIfAvailable().toString('utf-8').includes(
              contentSearch)
      ){
        filtered++;
        continue;
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
    let cube: Cube = await this.getCube(cubeKeyString);
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
    this.contentAreaView.setRawFieldContent(field, detailsTable, select.selectedIndex);
  }

  //***
  // Data conversion methods
  //***

  // TODO: try to parse as different families before resorting to raw
  // if more CubeFamily definitions are available
  async getCube(key: CubeKey | string): Promise<Cube> {
    let cube: Cube = await this.cubeStore.getCube(key);  // TODO: Add option to parse as something other than this CubeStore's default family
    if (cube === undefined) {  // unparseable, retry as raw
      cube = await this.cubeStore.getCube(key, rawCubeFamily);
    }
    return cube;
  }
}
