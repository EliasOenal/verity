import { Cube } from './cube';
import { CubeInfo } from './cubeInfo'
import { logger } from './logger';
import { CubePersistence } from "./cubePersistence";
import { EventEmitter } from 'events';
import * as fp from './fieldProcessing';
import { Buffer } from 'buffer';
import { Settings } from './config';

export class CubeStore extends EventEmitter {
  private storage: Map<string, CubeInfo> = new Map();
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
  }

  // TODO: implement importing CubeInfo directly
  async addCube(cube: Buffer): Promise<string | undefined>;
  async addCube(cube: Cube): Promise<string | undefined>;
  async addCube(cube_input: Cube | Buffer): Promise<string | undefined> {
      try {
        // Cube objects are ephemeral as storing binary data is more efficient.
        // Create cube object if we don't have one yet.
        let binaryCube: Buffer;
        let cube: Cube;
        if (cube_input instanceof Cube) {
          cube = cube_input;
          binaryCube = cube_input.getBinaryData();
        }
        else { // cube_input instanceof Buffer
          binaryCube = cube_input;
          cube = new Cube(binaryCube);
        }

        const cubeInfo: CubeInfo = await cube.getCubeInfo();
        const key: string = cubeInfo.key;

        // Sometimes we get the same cube twice (e.g. due to network latency).
        // In that case, do nothing -- no need to invalidate the hash or to
        // emit an event.
        if (this.hasCube(key)) {
          logger.error('CubeStorage: duplicate - cube already exists');
          return key;
        }

        // Store the cube
        // (This either creates a new dataset, or completes the existing dataset
        // with the actual cube if we already learnt some relationship
        // information beforehand.
        let dataset: CubeInfo = this.getOrCreateCubeInfo(key, binaryCube);

        // Create automatic relationship annotations for this cube
        // (if not disabled)
        this.autoAnnotate(key, cube, dataset);

        // save cube to disk (if available and enabled)
        if (this.persistence) {
          this.persistence.storeRawCube(key, cubeInfo.binaryCube);
        }

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
    const cubeInfo: CubeInfo = this.getCubeInfo(key);
    if (cubeInfo && cubeInfo.isComplete()) return true;
    else return false;
  }

  getNumberOfStoredCubes(): number {
    let ret = 0;
    for (const cubeInfo of this.storage.values()) {
      if (cubeInfo.isComplete()) ret++;
    }
    return ret;
  }


  private getOrCreateCubeInfo(key: string, binaryCube?: Buffer): CubeInfo {
    let cubeInfo: CubeInfo = this.getCubeInfo(key);
    if (!cubeInfo) {
      // we've never heard of this cube before -- create a new CubeInfo for it
      cubeInfo = new CubeInfo(key);
      this.storage.set(key, cubeInfo);
      // if (!cubeInfo) logger.trace("cubeStore: creating CubeInfo for anticipated unknown cube " + key);
      // else {
      //   logger.trace(`cubeStore: creating full CubeInfo (including the cube) for ${key}`);
      // }
    }
    // Do we still need to populate this cubeInfo with the actual cube?
    if (!cubeInfo.isComplete() && binaryCube) {
      cubeInfo.binaryCube = binaryCube;
      const cube: Cube = new Cube(binaryCube);
      cube.populateCubeInfo(cubeInfo);
      // logger.trace("cubeStore: populating CubeInfo with actual cube " + key);
    }
    return cubeInfo;
  }
  getCubeInfo(key: string): CubeInfo {
    return this.storage.get(key);
  }
  getCubeRaw(key: string): Buffer | undefined {
    const cubeInfo: CubeInfo = this.getCubeInfo(key);
    if (cubeInfo) return cubeInfo.binaryCube;
    else return undefined;
  }
  getCube(key: string): Cube | undefined {
    const cubeInfo: CubeInfo = this.getCubeInfo(key);
    if (cubeInfo) return cubeInfo.instantiate();
    else return undefined;
  }

  getAllStoredCubeKeys(): Set<string> {
    let ret: Set<string> = new Set();
    for (const [key, cubeInfo] of this.storage ) {
      if (cubeInfo.isComplete()) {  // if we actually have this cube
        ret.add(key);
      }
    }
    return ret;
  }

  // Emits cubeDisplayable events if this is the case
  isCubeDisplayable(key: string, cubeInfo?: CubeInfo, cube?: Cube): boolean {
  // TODO: move displayability logic somewhere else
    if (!cubeInfo) cubeInfo = this.getCubeInfo(key);
    if (!cubeInfo.isComplete()) return false;  // we don't even have this cube yet
    if (!cube) cube = cubeInfo.instantiate();

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
      const basePost: CubeInfo = this.getCubeInfo(reply_to.remoteKey);
      if (!basePost) return false;
      if (!this.isCubeDisplayable(reply_to.remoteKey)) return false;
    }
    return true;
  }
  private emitIfCubeDisplayable(
        key: string, cubeInfo?: CubeInfo, cube?: Cube): boolean {
    const displayable: boolean = this.isCubeDisplayable(key, cubeInfo, cube);
    logger.trace(`cubeStore: marking cube ${key} displayable`);
    if (displayable) this.emit('cubeDisplayable', key);
    return displayable;
  }

  // Emits cubeDisplayable events if this is the case
  emitIfCubeMakesOthersDisplayable(
      key: string, cubeInfo?: CubeInfo, cube?: Cube): boolean {
    let ret: boolean = false;
    if (!cubeInfo) cubeInfo = this.getCubeInfo(key);
    if (!cube) cube = cubeInfo.instantiate();

    // Am I the base post to a reply we already have?
    if (this.isCubeDisplayable(key, cubeInfo, cube)) {
      // In a base-reply relationship, I as a base can only make my reply
      // displayable if I am displayable myself.
      const replies: Array<fp.Relationship> = cubeInfo.getReverseRelationships(
        fp.RelationshipType.REPLY_TO);
      for (const reply of replies) {
        // logger.trace("cubeStore: for cube " + key + " I see a base post cube " + reply.remoteKey);
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
    this.persistence.storeCubes(this.storage);
  }

  private autoAnnotate(key: string, cube: Cube, dataset: CubeInfo) {
    if (!this.displayability_annotations) return;  // do I have to?

    for (const relationship of cube.getFields().getRelationships()) {
      const remoteDataset: CubeInfo =
        this.getOrCreateCubeInfo(relationship.remoteKey);
      const existingReverse: Array<fp.Relationship> =
        remoteDataset.getReverseRelationships(relationship.type, key);
      if (existingReverse.length == 0) {
        remoteDataset.reverseRelationships.push(
          new fp.Relationship(relationship.type, key));
        // logger.trace(`cubeStore: learning reverse relationship from ${relationship.remoteKey} to ${key}`)
      }
    }
  }

}
