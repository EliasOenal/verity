import { AnnotationEngine } from './annotationEngine';
import { Cube } from './cube';
import { CubeInfo } from './cubeInfo'
import { logger } from './logger';
import { CubePersistence } from "./cubePersistence";
import { EventEmitter } from 'events';
import { Buffer } from 'buffer';
import { Settings } from './config';

export class CubeStore extends EventEmitter {
  private storage: Map<string, CubeInfo> = new Map();

  // Refers to the persistant cube storage database, if available and enabled
  private persistence: CubePersistence = undefined;

  // If enabled, automatically generate reverse relationship annotations for each cube
  annotationEngine: AnnotationEngine = undefined;

  constructor(
      enable_persistence: boolean = true,
      auto_annotations: boolean = true) {
    super();
    this.setMaxListeners(Settings.MAXIMUM_CONNECTIONS + 10);  // one for each peer and a few for ourselves
    if (auto_annotations) {
      this.annotationEngine = new AnnotationEngine(this);
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
  async addCube(cube: Buffer): Promise<Buffer | undefined>;
  async addCube(cube: Cube): Promise<Buffer | undefined>;
  async addCube(cube_input: Cube | Buffer): Promise<Buffer | undefined> {
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
        const key: Buffer = cubeInfo.key;

        // Sometimes we get the same cube twice (e.g. due to network latency).
        // In that case, do nothing -- no need to invalidate the hash or to
        // emit an event.
        if (this.hasCube(key)) {
          logger.error('CubeStorage: duplicate - cube already exists');
          return key;
        }

        // Store the cube
        // (This either creates a new CubeInfo, or completes the existing CubeInfo
        // with the actual cube if we already learnt some relationship
        // information beforehand.
        this.getCreateOrPopulateCubeInfo(key, binaryCube);

        // save cube to disk (if available and enabled)
        if (this.persistence) {
          this.persistence.storeRawCube(key.toString('hex'), cubeInfo.binaryCube);
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


  hasCube(key: Buffer): boolean {
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

  // This should only really be used by addCube and the AnnotationEngine,
  // but I can't make it private
  getCreateOrPopulateCubeInfo(key: Buffer, binaryCube?: Buffer): CubeInfo {
    let cubeInfo: CubeInfo = this.getCubeInfo(key);
    if (!cubeInfo) {
      // we've never heard of this cube before -- create a new CubeInfo for it
      cubeInfo = new CubeInfo(key);
      this.storage.set(key.toString('hex'), cubeInfo);
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
  getCubeInfo(key: Buffer): CubeInfo {
    return this.storage.get(key.toString('hex'));
  }
  getCubeRaw(key: Buffer): Buffer | undefined {
    const cubeInfo: CubeInfo = this.getCubeInfo(key);
    if (cubeInfo) return cubeInfo.binaryCube;
    else return undefined;
  }
  getCube(key: Buffer): Cube | undefined {
    const cubeInfo: CubeInfo = this.getCubeInfo(key);
    if (cubeInfo) return cubeInfo.instantiate();
    else return undefined;
  }

  getAllStoredCubeKeys(): Set<Buffer> {
    let ret: Set<Buffer> = new Set();
    for (const [key, cubeInfo] of this.storage ) {
      if (cubeInfo.isComplete()) {  // if we actually have this cube
        ret.add(Buffer.from(key));
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

}
