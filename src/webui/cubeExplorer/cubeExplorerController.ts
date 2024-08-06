import { coreCubeFamily, type Cube } from "../../core/cube/cube";
import type { CubeField } from "../../core/cube/cubeField";
import { logger } from "../../core/logger";
import { getElementAboveByClassName } from "../helpers/dom";
import { CubeExplorerView } from "./cubeExplorerView";
import { ControllerContext, VerityController, VerityControllerOptions } from "../verityController";
import type { CubeKey } from "../../core/cube/cube.definitions";
import { CubeStore } from "../../core/cube/cubeStore";

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

// TODO move somewhere else
/**
 * Abortable CubeStore walk
 */
class CubeStoreWalk {
  private _abort: boolean = false;

  constructor(private cubeStore: CubeStore) {
  }

  abort() {
    this._abort = true;
  }

  async *keys(asString: boolean = false): AsyncGenerator<CubeKey|string> {
    for await (const key of this.cubeStore.getAllKeys(asString)) {
      if (this._abort) return;
      yield key;
    }
  }

  // TODO implement: async *binaryCubes(): AsyncGenerator<Buffer>
}

const DEFAULT_MAX_CUBES = 1000;  // TODO move to config

export interface CubeExplorerControllerOptions extends VerityControllerOptions {
  maxCubes?: number;
}

export class CubeExplorerController extends VerityController {
  declare public contentAreaView: CubeExplorerView;
  declare readonly options: CubeExplorerControllerOptions;
  private storeWalk: CubeStoreWalk;

  constructor(
      parent: ControllerContext,
      options: CubeExplorerControllerOptions = {},
  ){
    super(parent, options);
    this.options.maxCubes ??= DEFAULT_MAX_CUBES;

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
  // TODO pagination (we currently just abort after maxCubes and print a warning)
  // TODO sorting (e.g. by date)
  redisplay(filter?: CubeFilter): Promise<void> {
    if (filter === undefined) filter = this.contentAreaView.fetchCubeFilter();
    else if (filter === null) filter = {};
    this.contentAreaView.displayCubeFilter(filter);

    this.contentAreaView.clearAll();
    this.buildCubeList(filter);  // note we are *not* await-ing this to be done

    // view may be shown immediately while we're still processing,
    // so return a resolved promise
    return new Promise<void>((resolve) => resolve());
  }

  async buildCubeList(filter?: CubeFilter): Promise<void> {
    // start a new CubeStore walk; abort the previous one if any
    if (this.storeWalk) this.storeWalk.abort();
    this.storeWalk = new CubeStoreWalk(this.cubeStore);

    // prepare some stats
    let processed = 0, displayed = 0, filtered = 0;

    for await (const key of this.storeWalk.keys(true)) {
      // update stats to reflect progress
      processed++;
      this.contentAreaView.displayStats(processed, displayed, filtered);

      // Apply key filter
      if (filter.key !== undefined && !key.includes(filter.key)) {
        filtered++;
        continue;  // skip non-matching
      }

      // Apply further filters if specified
      if (filter.dateFrom !== undefined ||
          filter.dateTo !== undefined ||
          filter.content !== undefined) {
        const cubeInfo = await this.cubeStore.getCubeInfo(key);

        // prepare raw content filter if specified
        let decodedBinary: string;
        if (filter.content !== undefined) {
          decodedBinary = cubeInfo.binaryCube.toString(
            EncodingIndex[filter.contentEncoding] as BufferEncoding);
        }
        // apply filters
        if ((filter.dateFrom !== undefined && cubeInfo.date < filter.dateFrom) ||
            (filter.dateTo !== undefined && cubeInfo.date > filter.dateTo) ||
            (filter.content !== undefined && !decodedBinary.includes(filter.content)
           )
        ){
          filtered++;
          continue;
        }
      }

      // All filters matched, we're gonna display this one
      displayed++;
      this.contentAreaView.displayCubeSummary(key as string);
      if (displayed >= this.options.maxCubes) {
        this.contentAreaView.makeAlertBelowCubes("info",
          `Maximum of ${displayed} Cubes displayed, rest omitted. Consider narrower filter.`);
        break;
      }
    }
    this.contentAreaView.displayStats(processed, displayed, filtered);
  }

  async toggleCubeDetails(key: string): Promise<void> {
    // Fetch this Cube and render its details into the view.
    // Only when the details have been rendered may we toggle the visibility.
    // TODO: We currently do this on every toggle click which is nonsense, the
    // details only need to be rendered once and, in particular, need not be
    // re-rendered on a hide action.
    await this.renderCubeDetails(key);
    this.contentAreaView.toggleCubeDetails(key);
  }

  async renderCubeDetails(key: string): Promise<void> {
    const cube: Cube = await this.getCube(key);
    if (cube === undefined) {
      this.contentAreaView.makeCubeAlert(key, "danger", "Unable to parse cube");
      return;
    }
    this.contentAreaView.displayCubeDetails(key, cube);
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
      cube = await this.cubeStore.getCube(key, coreCubeFamily);
    }
    if (cube === undefined) {
      logger.error("CubeExplorerController.getCube(): Unable to parse Cube " + key);
      return undefined;
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

  close(unshow?: boolean, callback?: boolean): Promise<void> {
    this.storeWalk.abort();
    return super.close(unshow, callback);
  }

  shutdown(unshow?: boolean, callback?: boolean): Promise<void> {
    this.storeWalk.abort();
    return super.shutdown(unshow, callback);
  }
}
