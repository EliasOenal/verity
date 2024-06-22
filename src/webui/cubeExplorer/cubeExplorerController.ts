import { rawCubeFamily, type Cube } from "../../core/cube/cube";
import type { CubeField } from "../../core/cube/cubeField";
import { logger } from "../../core/logger";
import { getElementAboveByClassName } from "../helpers";
import { CubeExplorerView } from "./cubeExplorerView";
import { ControllerContext, VerityController, VerityControllerOptions } from "../verityController";
import type { CubeKey } from "../../core/cube/cubeDefinitions";

export interface CubeFilter {
  key?: string,
  dateFrom?: number;
  dateTo?: number;
  content?: string;
  contentEncoding?: EncodingIndex;
}

export enum EncodingIndex {
  // always make sure these match the select option order in index.html
  utf8 = 1,
  utf16le = 2,
  hex = 3,
}

const DEFAULT_MAX_CUBES = 1000;  // TODO move to config

export interface CubeExplorerControllerOptions extends VerityControllerOptions {
  maxCubes?: number;
}

export class CubeExplorerController extends VerityController {
  declare public contentAreaView: CubeExplorerView;
  declare readonly options: CubeExplorerControllerOptions;

  constructor(
      parent: ControllerContext,
      options: CubeExplorerControllerOptions = {},
  ){
    super(parent);
    options.maxCubes = options.maxCubes ?? DEFAULT_MAX_CUBES;

    this.contentAreaView = new CubeExplorerView(this);
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
   * @param [filter] If defined, only show Cubes matching this filter.
   *   If undefined / not supplied, will try to fetch filter setting from the
   *   view. If you explicitly want no filter, set to null.
   */
  // TODO refined cube search (e.g. by date, fields present or even field content)
  // TODO pagination (we currently just abort after maxCubes and print a warning)
  // TODO sorting (e.g. by date)
  // TODO support non CCI cubes (including invalid / partial CCI cubes)
  redisplay(filter?: CubeFilter): Promise<void> {
    if (filter === undefined) filter = this.contentAreaView.fetchCubeFilter();
    else if (filter === null) filter = {};
    this.contentAreaView.displayCubeFilter(filter);

    this.contentAreaView.clearAll();
    let initialPromise: Promise<number> = this.cubeStore.getNumberOfStoredCubes();
    initialPromise.then(async (total: number) => {
      let displayed = 0, unparsable = 0, filtered = 0;
      for await (const key of this.cubeStore.getAllKeys(true)) {
        // update stats to reflect parsing progress
        this.contentAreaView.displayStats(total, displayed, filtered);
        // Apply key filter before even activating this Cube
        if (filter.key !== undefined && !key.includes(filter.key)) {
          filtered++;
          continue;  // skip non-matching
        }
        // fetch Cube
        const cube: Cube = await this.getCube(key);
        if (cube === undefined) {  // unparseable, giving up
          unparsable++;
          continue;
        }
        // apply further filters:
        // prepare raw content filter if specified
        let decodedBinary: string;
        if (filter.content) {
          decodedBinary = cube.getBinaryDataIfAvailable().toString(
            EncodingIndex[filter.contentEncoding] as BufferEncoding);
        }
        // apply filters
        if ((filter.dateFrom !== undefined && cube.getDate() < filter.dateFrom) ||
            (filter.dateTo !== undefined && cube.getDate() > filter.dateTo) ||
            (filter.content !== undefined && !decodedBinary.includes(filter.content)
            )
        ){
          filtered++;
          continue;
        }
        displayed++;
        this.contentAreaView.displayCube(key as string, cube);
        if (displayed >= this.options.maxCubes) {
          this.contentAreaView.showBelowCubes(`Maximum of ${displayed} Cubes displayed, rest omittted. Consider narrower filter.`);
          break;
        }
      }
      this.contentAreaView.displayStats(total, displayed, filtered);
    });
    // View can be displayed as soon as the first CubeStore operation
    // has succeeded. More Cubes will then be added to the list as they get
    // parsed.
    return initialPromise as unknown as Promise<void>;
  }

  //***
  // Navigation methods
  //***

  async changeEncoding(select: HTMLSelectElement) {
    const cubeLi: HTMLLIElement =
      getElementAboveByClassName(select, "verityCube") as HTMLLIElement;
    const cubeKeyString = cubeLi?.getAttribute("data-cubekey");
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
    this.contentAreaView.setRawFieldContent(field, detailsTable, EncodingIndex[select.value]);
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

  //***
  // Framework event handling
  //***
  async identityChanged(): Promise<boolean> {
    // this controller does not care about user Identites
    return true;
  }
}
