import { ReadyPromise, Shuttable } from "./coreInterfaces";
import { logger } from "../logger";

import { EventEmitter } from "events";

export interface RecursiveEmitterConstituent extends EventEmitter {
  getSubemitters(): AsyncGenerator<RecursiveEmitterConstituent>;
}

export interface RecursiveEmitterRecord {
  emitter: RecursiveEmitterConstituent;
  event: string;
  reemitAs?: string;
}

export interface RecursiveEmitterOptions {
  depth?: number;
}

interface SubscribedEmitter extends RecursiveEmitterRecord {
  handler: (data: any) => void;
}

/**
 * A recursive emitter subscribes to a user-supplied list of emitters, as well
 * as any subemitters of those emitters as referenced by those emitter's
 * `getSubemitters` method.
 * It will then re-emit events from all of those emitters.
 */
export class RecursiveEmitter extends EventEmitter implements ReadyPromise, Shuttable {
  private emitters: SubscribedEmitter[] = [];

  // Implement the ReadyPromise interface
  readonly ready: Promise<void>;
  private _isReady: boolean = false;
  get isReady(): boolean { return this._isReady }

  constructor(
    emitters: RecursiveEmitterRecord[],
    readonly options: RecursiveEmitterOptions = {},
  ) {
    // set default options
    options.depth ??= 10;

    super();

    // Subscribe to all emitters.
    // We will start emitting immediately after we're subscribed, but we'll only
    // declare ourselves fully ready once all subscriptions have completed.
    this.ready = Promise.all(
      emitters.map(emitter => this.recursiveSubscribe(emitter, 0))).then(() => {
        this._isReady = true;
    });
  }

  private async recursiveSubscribe(record: RecursiveEmitterRecord, depth: number): Promise<void> {
    // Prevent infinite recursion
  const maxDepth = this.options.depth ?? 10; // safety default
  if (depth > maxDepth) {
      logger.trace("RecursiveEmitter.recursiveSubscribe(): max recursion depth reached, skipping further references");
      return Promise.resolve();
    }
    // Prevent duplicate subscriptions
    if (this.alreadySubscribed(record)) {
      logger.trace("RecursiveEmitter.recursiveSubscribe(): skipping duplicate subscription");
      return Promise.resolve();
    }

    // Subscribe to the emitter itself
    const handler = (data: any) => {
      const eventName = record.reemitAs ?? record.event;
      this.emit(eventName, data);
    };
    this.emitters.push({...record, handler});
    record.emitter.on(record.event, handler);

    // Traverse subemitters
    const promises: Promise<void>[] = [];
    for await (const subemitter of record.emitter.getSubemitters()) {
      promises.push(
        this.recursiveSubscribe({ ...record, emitter: subemitter }, depth + 1));
    }
    return Promise.all(promises).then(() => undefined);
  }

  private alreadySubscribed(record: RecursiveEmitterRecord): boolean {
    return this.emitters.some(emitter =>
      emitter.emitter === record.emitter &&
      emitter.event === record.event &&
      emitter.reemitAs === record.reemitAs
    );
  }

  // Implement the Shuttable interface
  shutdown(): Promise<void> {
    this._shutdown = true;

    // unsubscribe from all events
    for (const emitter of this.emitters) {
      emitter.emitter.removeListener(emitter.event, emitter.handler);
    }
    // clear references to emitters to facilitate garbage collection
    this.emitters = [];

    this.shutdownPromiseResolve();
    return this.shutdownPromise;
  }
  private _shutdown: boolean = false;
  get shuttingDown(): boolean { return this._shutdown }
  private shutdownPromiseResolve!: () => void;
  shutdownPromise: Promise<void> = new Promise(resolve => { this.shutdownPromiseResolve = resolve; });
}
