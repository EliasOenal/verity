import { Cube, CubeInfo } from './cube';
import { logger } from './logger';
import { CubePersistence } from "./cubePersistence";
import { EventEmitter } from 'events';
import * as fp from './fieldProcessing';
import { Buffer } from 'buffer';

// TODO: merge CubeDataset into CubeInfo
export class CubeDataset {
  cubeInfo: CubeInfo = undefined;  // more efficient than storing cube objects
  reverseRelationships: Array<fp.Relationship> = [];
  applicationNotes: Map<any, any> = new Map();

  constructor(cube: Cube | CubeInfo | Buffer) {
    if (cube instanceof Cube) this.cubeInfo = cube.getCubeInfo();
    else if (cube instanceof CubeInfo) this.cubeInfo = cube;
    else if (cube instanceof Buffer) this.cubeInfo = new Cube(cube).getCubeInfo();
    else this.cubeInfo = undefined;
  }

  // TODO: use fp.getRelationships for that
  getReverseRelationships(type?: fp.RelationshipType, remoteKey?: string): Array<fp.Relationship> {
    let ret = [];
    for (const reverseRelationship of this.reverseRelationships) {
      if (
        (!type || type == reverseRelationship.type) &&
        (!remoteKey) || remoteKey == reverseRelationship.remoteKey ) {
          ret.push(reverseRelationship);
        }
    }
    return ret;
  }
}

export class CubeStore extends EventEmitter {
  private storage: Map<string, CubeDataset> = new Map();
  private allKeys: Buffer[] | undefined = undefined;
  private allCubeInfos: CubeInfo[] | undefined;

  // Refers to the persistant cube storage database, if available and enabled
  private persistence: CubePersistence = undefined;

  // Automatically generate reverse relationship annotations for each cube
  private auto_annotate: boolean = true;

  constructor(
      enable_persistence: boolean = true,
      auto_annotate: boolean = true) {
    super();
    this.auto_annotate = auto_annotate;
    if (enable_persistence) {
      this.persistence = new CubePersistence();

      // this.persistence.on("ready", this.syncPersistentStorage);
      this.persistence.on('ready', () => {
        logger.trace("cubeStore: received ready event from cubePersistence");
        this.syncPersistentStorage();
      });
    }

    this.storage = new Map();
    this.allKeys = undefined;
  }

  // TODO: implement importing CubeInfo directly
  async addCube(cube: Buffer): Promise<string | undefined>;
  async addCube(cube: Cube): Promise<string | undefined>;
  async addCube(cube: Cube | Buffer): Promise<string | undefined> {
      try {
        // Cube objects are ephemeral as storing binary data is more efficient.
        // Create cube object if we don't have one yet.
        if (cube instanceof Buffer)
          cube = new Cube(cube);

        const keybuffer: Buffer = await cube.getKey();
        const key: string = keybuffer.toString('hex');

        // Sometimes we get the same cube twice (e.g. due to network latency).
        // In that case, do nothing -- no need to invalidate the hash or to emit an event.
        if (this.storage.has(key)) {
          logger.error('CubeStorage: duplicate - cube already exists');
          return key;
        }
        this.allKeys = undefined;  // invalidate cache, will regenerate automatically

        // Store the cube
        // (This either creates a new dataset, or completes the existing dataset
        // with the actual cube if we already learnt some relationship
        // information beforehand.
        let dataset: CubeDataset = this.getOrCreateCubeDataset(
          key, cube.getBinaryData());

        // Create automatic relationship annotations for this cube (if not disabled)
        this.autoAnnotate(key, cube, dataset);

        // save cube to disk (if available and enabled)
        if (this.persistence) this.persistence.storeRawCube(key, dataset.cubeInfo.cubeData);

        // inform our application(s) about the new cube
        this.emit('cubeAdded', key, dataset, cube);

        return key;
      } catch (e) {
        if (e instanceof Error) {
          logger.error('Error adding cube:' + e.message);
        } else {
          logger.error('Error adding cube:' + e);
        }
        return undefined;
      }
  }


  hasCube(key: string): boolean {
    if (this.getCubeRaw(key)) return true;
    else return false;
  }

  getNumberOfStoredCubes(): number {
    let ret = 0;
    for (const dataset of this.storage.values()) {
      if (dataset.cubeInfo) ret++;
    }
    return ret;
  }

  getCubeDataset(key: string): CubeDataset {
    return this.storage.get(key);
  }
  private getOrCreateCubeDataset(key: string, rawcube?: Buffer): CubeDataset {
    let dataset: CubeDataset = this.getCubeDataset(key);
    if (!dataset) {
      dataset = new CubeDataset(rawcube);
      this.storage.set(key, dataset);
    }
    return dataset;
  }
  getCubeRaw(key: string): CubeInfo | undefined {
    const dataset: CubeDataset = this.getCubeDataset(key);
    if (dataset) return dataset.cubeInfo;
    else return undefined;
  }
  getCube(key: string): Cube | undefined {
    const dataset: CubeDataset = this.storage.get(key);
    if (dataset) return new Cube(dataset.cubeInfo.cubeData);
    else return undefined;
  }

  getAllKeysAsBuffer(): Buffer[] {
    if (this.allKeys) {
      return this.allKeys;
    }
    this.allKeys = Array.from(this.storage.keys()).map(key => Buffer.from(key, 'hex'));
    return this.allKeys;
  }

  // This gets called once a persistence object is ready.
  // We will then proceed to store all of our cubes into it,
  // and load all cubes from it.
  private async syncPersistentStorage() {
    if (!this.persistence) return;
    for (const rawcube of await this.persistence.requestRawCubes()) {
      this.addCube(Buffer.from(rawcube));
    }
    this.persistence.storeRawCubes(this.storage);
  }

  private autoAnnotate(key: string, cube: Cube, dataset: CubeDataset) {
    if (!this.auto_annotate) return;  // do I have to?

    for (const relationship of cube.getFields().getRelationships()) {
      const remoteDataset: CubeDataset =
        this.getOrCreateCubeDataset(relationship.remoteKey);
      const existingReverse: Array<fp.Relationship> =
        remoteDataset.getReverseRelationships(relationship.type, key);
      if (existingReverse.length == 0) {
        remoteDataset.reverseRelationships.push(new fp.Relationship(relationship.type, key));
      }
    }
  }

}
