/**
 * Verity Core - Low-level API
 *
 * This module exports core functionality for advanced use cases.
 * Most applications should use the main `verity` module instead.
 *
 * Import from this module as: `import {} from "verity/core"`
 */

// Core Node
export { CoreNode } from './coreNode.js';
export type { CoreNodeIf, CoreNodeOptions } from './coreNode.js';

// Cube Storage
export { CubeStore } from './cube/cubeStore.js';
export { CoreCube, coreCubeFamily } from './cube/coreCube.js';
export { CubeInfo } from './cube/cubeInfo.js';
export { CubeField } from './cube/cubeField.js';
export { CubeFields } from './cube/cubeFields.js';
export type { CubeFamilyDefinition, FieldParserTable } from './cube/cubeFields.js';

// Cube utilities
export * as CubeUtil from './cube/cubeUtil.js';
export * from './cube/keyUtil.js';

// Cube definitions and types
export { CubeType, CubeKey, NotificationKey } from './cube/coreCube.definitions.js';
export type { CubeRetrievalInterface, CubeIteratorOptions } from './cube/cubeRetrieval.definitions.js';

// Networking
export { NetworkManager } from './networking/networkManager.js';
export type { NetworkManagerIf, NetworkManagerOptions } from './networking/networkManagerIf.js';

export { NetworkPeer } from './networking/networkPeer.js';
export type { NetworkPeerIf, NetworkPeerOptions, NetworkStats } from './networking/networkPeerIf.js';

export { CubeRetriever } from './networking/cubeRetrieval/cubeRetriever.js';
export type { CubeRequestOptions } from './networking/cubeRetrieval/requestScheduler.js';

// Network definitions and constants
export { NetConstants, NodeType, MessageClass, SupportedTransports } from './networking/networkDefinitions.js';

// Peering
export { Peer } from './peering/peer.js';
export { PeerDB } from './peering/peerDB.js';
export { AddressAbstraction, WebSocketAddress } from './peering/addressing.js';

// Settings
export { Settings, VerityError, ApiMisuseError } from './settings.js';

// Logger
export { logger } from './logger.js';

// Testing utilities (for test code)
export { DummyNetworkManager } from './networking/testingDummies/dummyNetworkManager.js';
export { DummyNetworkPeer } from './networking/testingDummies/dummyNetworkPeer.js';
