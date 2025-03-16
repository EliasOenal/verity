export interface ReadyPromise {
  readonly ready: Promise<void>;
  get isReady(): boolean;
}

export interface Shuttable {
  shutdown(): Promise<void>;
  get shuttingDown(): boolean;
  shutdownPromise: Promise<void>;
}
