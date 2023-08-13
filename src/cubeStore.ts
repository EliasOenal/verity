import { Cube, CubeInfo } from './cube';
import { logger } from './logger';
import { CubePersistence } from "./cubePersistence";
import { EventEmitter } from 'events';
import * as fp from './fieldProcessing';
import { Buffer } from 'buffer';
import { Settings } from './config';

// TODO: merge CubeDataset into CubeInfo
export class CubeDataset {
  cubeInfo: CubeInfo = undefined;  // more efficient than storing cube objects
  reverseRelationships: Array<fp.Relationship> = [];
  applicationNotes: Map<any, any> = new Map();

  constructor(cubeInfo: CubeInfo) {
    this.cubeInfo = cubeInfo;
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
  // TODO: this should probably be moved somewhere else
  private displayability_annotations: boolean = true;

  constructor(
      enable_persistence: boolean = true,
      displayability_annotations: boolean = true) {
    super();
    this.setMaxListeners(Settings.MAXIMUM_CONNECTIONS + 10);  // one for each peer and a few for ourselves
    this.displayability_annotations = displayability_annotations;
    if (this.displayability_annotations) {
      this.on('cubeAdded', (key) => this.emitIfCubeDisplayable(key));
      this.on('cubeAdded', (key) => this.emitIfCubeMakesOthersDisplayable(key));
    }
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

        const cubeInfo: CubeInfo = await cube.getCubeInfo();
        const key: string = cubeInfo.key.toString('hex');

        // Sometimes we get the same cube twice (e.g. due to network latency).
        // In that case, do nothing -- no need to invalidate the hash or to emit an event.
        if (this.hasCube(key)) {
          logger.error('CubeStorage: duplicate - cube already exists');
          return key;
        }
        this.allKeys = undefined;  // invalidate cache, will regenerate automatically

        // Store the cube
        // (This either creates a new dataset, or completes the existing dataset
        // with the actual cube if we already learnt some relationship
        // information beforehand.
        let dataset: CubeDataset = this.getOrCreateCubeDataset(
          key, cubeInfo);

        // Create automatic relationship annotations for this cube (if not disabled)
        this.autoAnnotate(key, cube, dataset);

        // save cube to disk (if available and enabled)
        if (this.persistence) this.persistence.storeRawCube(key, cubeInfo.cubeData);

        // inform our application(s) about the new cube
        this.emit('cubeAdded', key);

        // All done finally, just return the key in case anyone cares.
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


  private getOrCreateCubeDataset(key: string, cubeInfo?: CubeInfo): CubeDataset {
    let dataset: CubeDataset = this.getCubeDataset(key);
    if (!dataset) {
      dataset = new CubeDataset(cubeInfo);
      this.storage.set(key, dataset);
      if (!cubeInfo) logger.trace("cubeStore: creating CubeDataset for anticipated unknown cube " + key);
      else {
        logger.trace(`cubeStore: creating full CubeDataset (including the cube) for ${key}`);
      }
    } else if (cubeInfo && !dataset.cubeInfo) {
      dataset.cubeInfo = cubeInfo;
      logger.trace("cubeStore: populating existing CubeDataset with actual cube " + key);
    }
    return dataset;
  }
  getCubeDataset(key: string): CubeDataset {
    return this.storage.get(key);
  }
  getCubeRaw(key: string): CubeInfo | undefined {
    const dataset: CubeDataset = this.getCubeDataset(key);
    if (dataset) return dataset.cubeInfo;
    else return undefined;
  }
  getCube(key: string): Cube | undefined {
    const cubeInfo: CubeInfo = this.getCubeRaw(key);
    if (cubeInfo) return new Cube(cubeInfo.cubeData);
    else return undefined;
  }

  getAllKeysAsBuffer(): Buffer[] {
    if (this.allKeys) {
      return this.allKeys;
    }
    this.allKeys = Array.from(this.storage.keys()).map(key => Buffer.from(key, 'hex'));
    return this.allKeys;
  }

  // Emits cubeDisplayable events if this is the case
  isCubeDisplayable(key: string, dataset?: CubeDataset, cube?: Cube): boolean {
  // TODO: move displayability logic somewhere else
    if (!dataset) dataset = this.getCubeDataset(key);
    if (!dataset.cubeInfo) return false;  // we don't even have this cube yet
    if (!cube) cube = new Cube(dataset.cubeInfo.cubeData);

    // TODO: handle continuation chains
    // TODO: parametrize and handle additional relationship types on request
    // TODO: as discussed, this whole decision process (and the related attributes
    // in CubeDataset) should at some point not be applies to all cubes,
    // just to interesting ones that are actually to be displayed.

    // are we a reply?
    // if we are, we can only be displayed if we have the original post,
    // and the original post is displayable too
    const reply_to: fp.Relationship =
      cube.getFields().getFirstRelationship(fp.RelationshipType.REPLY_TO);
    if (reply_to) {
      const basePost: CubeDataset = this.getCubeDataset(reply_to.remoteKey);
      if (!basePost) return false;
      if (!this.isCubeDisplayable(reply_to.remoteKey)) return false;
    }
    logger.trace(`cubeStore: marking cube ${key} displayable`);
    return true;
  }
  private emitIfCubeDisplayable(key: string, dataset?: CubeDataset, cube?: Cube): boolean {
    const displayable: boolean = this.isCubeDisplayable(key, dataset, cube);
    if (displayable) this.emit('cubeDisplayable', key);
    return displayable;
  }

 static eventtest(event) {
    logger.trace("EVENT HANDLER CALLED");
  }

  // Emits cubeDisplayable events if this is the case
  emitIfCubeMakesOthersDisplayable(key: string, dataset?: CubeDataset, cube?: Cube): boolean {
    let ret: boolean = false;
    if (!dataset) dataset = this.getCubeDataset(key);
    if (!cube) cube = new Cube(dataset.cubeInfo.cubeData);

    // Am I the base post to a reply we already have?
    if (this.isCubeDisplayable(key, dataset, cube)) {
      // in a base-reply relationship, I as a base can only make my reply displayable
      // if I am displayable myself
      const replies: Array<fp.Relationship> = dataset.getReverseRelationships(fp.RelationshipType.REPLY_TO);
      for (const reply of replies) {
        logger.trace("cubeStore: for cube " + key + " I see a base post cube " + reply.remoteKey);
        if (this.emitIfCubeDisplayable(reply.remoteKey)) {  // will emit a cubeDisplayable event for reply.remoteKey if so
          ret = true;
          this.emitIfCubeMakesOthersDisplayable(reply.remoteKey);
        }
      }
    }
    return ret;
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
    if (!this.displayability_annotations) return;  // do I have to?

    for (const relationship of cube.getFields().getRelationships()) {
      const remoteDataset: CubeDataset =
        this.getOrCreateCubeDataset(relationship.remoteKey);
      const existingReverse: Array<fp.Relationship> =
        remoteDataset.getReverseRelationships(relationship.type, key);
      if (existingReverse.length == 0) {
        remoteDataset.reverseRelationships.push(new fp.Relationship(relationship.type, key));
        logger.trace(`cubeStore: learning reverse relationship from ${relationship.remoteKey} to ${key}`)
      }
    }
  }

}
