export interface Shuttable {
  shutdown(): Promise<void>;
  get shuttingDown(): boolean;
  shutdownPromise: Promise<void>;
}