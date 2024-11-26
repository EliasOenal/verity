import { VerityNodeOptions } from "../../src/core/verityNode";

export const testCoreOptions: VerityNodeOptions = {
  inMemory: true,
  enableCubeRetentionPolicy: false,
  requiredDifficulty: 0,
  announceToTorrentTrackers: false,
  autoConnect: true,
  peerExchange: false,
  initialPeers: [],
  requestInterval: 20, // yes, repeating requests fifty times per second totally is a sensible idea!
  networkTimeoutMillis: 100,  // all local, no request should take longer than 100ms
};
export const requiredDifficulty = 0;
