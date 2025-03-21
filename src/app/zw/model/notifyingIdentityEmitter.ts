import { CubeKey, HasNotify, CubeFieldType } from "../../../core/cube/cube.definitions";
import { CubeInfo } from "../../../core/cube/cubeInfo";
import { CubeEmitter, CubeEmitterEvents, CubeRetrievalInterface, CubeStore } from "../../../core/cube/cubeStore";
import { keyVariants } from "../../../core/cube/cubeUtil";
import { Shuttable } from "../../../core/helpers/coreInterfaces";
import { CubeRetriever } from "../../../core/networking/cubeRetrieval/cubeRetriever";

import { cciCube } from "../../../cci/cube/cciCube";
import { isCci } from "../../../cci/cube/cciCubeUtil";
import { Identity } from "../../../cci/identity/identity";
import { IdentityStore } from "../../../cci/identity/identityStore";

import { ZwConfig } from "./zwConfig";

import EventEmitter from "events";

export interface NotifyingIdentityEmitterOptions {
  notificationKey?: CubeKey;
  identityRecursionDepth?: number;
}

export class NotifyingIdentityEmitter extends EventEmitter<CubeEmitterEvents> implements CubeEmitter, Shuttable {
  identities: Map<string, Identity> = new Map();


  constructor(
    private cubeRetriever: CubeRetriever | CubeRetrievalInterface,
    readonly identityStore?: IdentityStore,
    public options: NotifyingIdentityEmitterOptions = {},
  ) {
    // set default options
    options.notificationKey ??= ZwConfig.NOTIFICATION_KEY;
    options.identityRecursionDepth ??= 5;
    super();

    if (identityStore === undefined) this.identityStore = new IdentityStore(this.cubeRetriever);
    this.cubeRetriever.cubeStore.on('cubeAdded', this.learnIdentity);
    if ('requestScheduler' in this.cubeRetriever) {  // HACKHACK
      this.cubeRetriever.requestScheduler.networkManager.on('peeronline', this.requestNotifications);  // need notification subscriptions and auto-retries in RequestScheduler :(
    }
    (async() => {
      for await (const cubeInfo of this.cubeRetriever.cubeStore.getNotificationCubeInfos(this.options.notificationKey)) {
        this.learnIdentity(cubeInfo);
      }
    })();
  }

  async *getAllCubeInfos(): AsyncGenerator<CubeInfo> {
    for (const identity of this.identities.values()) {
      yield* identity.getAllCubeInfos();
    }
  }

  private requestNotifications = (): void => {
    if ('requestScheduler' in this.cubeRetriever) {  // HACKHACK
      this.cubeRetriever.requestScheduler.requestNotifications(this.options.notificationKey);
    }
  }

  private learnIdentity = (cubeInfo: CubeInfo): void => {
    try {
      if (HasNotify[cubeInfo.cubeType]) {
        const cube = cubeInfo.getCube() as cciCube;
        if (isCci(cube) && cube.getFirstField(CubeFieldType.NOTIFY)?.value.equals(this.options.notificationKey)) {
            if (this.identities.has(cube.getKeyStringIfAvailable())) return;
            const identity = new Identity(this.cubeRetriever, cube, { identityStore: this.identityStore });
            if (identity) {
              if (this.identities.has(identity.keyString)) {
                identity.shutdown();
                return;
              }
              this.identities.set(identity.keyString, identity);
              const emitter = identity.getRecursiveEmitter({event: 'cubeAdded', depth: this.options.identityRecursionDepth });
              emitter.on('cubeAdded', this.reEmit);
              // initial emit
              (async() => {
                for await (const cubeInfo of identity.getAllCubeInfos()) {
                  this.reEmit(cubeInfo);
                }
              })();
            }
        }
      }
    } catch (e) {}  // probably not an Identity Cube
  }

  private reEmit = (cubeInfo: CubeInfo): void => {
    this.emit('cubeAdded', cubeInfo);
  }

  // implement Shuttable
  private _shuttingDown: boolean = false;
  get shuttingDown(): boolean { return this._shuttingDown; }

  shutdown(): Promise<void> {
    this._shuttingDown = true;

    // remove my subscriptions
    this.cubeRetriever.cubeStore.removeListener('cubeAdded', this.learnIdentity);
    if ('requestScheduler' in this.cubeRetriever) {  // HACKHACK
      this.cubeRetriever.requestScheduler.networkManager.removeListener('peeronline', this.requestNotifications);
    }

    // remove subscriptions from my Identities and shut them down
    for (const identity of this.identities.values()) {
      identity.removeListener('cubeAdded', this.reEmit);
      identity.shutdown();  // TODO will this interfere with a change of nav action?
      this.identities.delete(identity.keyString);
    }

    this.resolveShutdownPromise();
    return this.shutdownPromise;
  }
  private resolveShutdownPromise: () => void;
  shutdownPromise: Promise<void> = new Promise(resolve => {
    this.resolveShutdownPromise = resolve;
  })
}