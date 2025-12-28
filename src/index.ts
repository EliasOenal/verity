/**
 * Verity - Main API
 *
 * This is the primary public-facing API for Verity applications.
 * Most applications should import from this module.
 *
 * For low-level core functionality, use `import {} from "verity/core"`.
 */

// High-level CCI API - Main application interface
export { Cockpit } from './cci/cockpit.js';
export type { CockpitOptions, PublishVeritumOptions } from './cci/cockpit.js';

export { Veritum } from './cci/veritum/veritum.js';
export { VeritumCreateOptions, VeritumCompileOptions, VeritumFromChunksOptions } from './cci/veritum/veritum.definitions.js';

export { VerityNode, dummyVerityNode } from './cci/verityNode.js';
export type { VerityNodeIf, VerityNodeOptions } from './cci/verityNode.js';

// Cube API
export { Cube, cciFamily } from './cci/cube/cube.js';
export { CubeCreateOptions, CubeType, CubeKey, NotificationKey } from './core/cube/coreCube.definitions.js';

export { VerityField } from './cci/cube/verityField.js';
export { VerityFields } from './cci/cube/verityFields.js';
export { FieldType, MediaTypes, FieldLength } from './cci/cube/cube.definitions.js';

export { Relationship, RelationshipType } from './cci/cube/relationship.js';

// Identity API
export { Identity } from './cci/identity/identity.js';
export type { IdentityOptions, IdentityLoadOptions, IdentityEvents, GetPostsOptions } from './cci/identity/identity.definitions.js';

export { IdentityStore } from './cci/identity/identityStore.js';

export { Avatar, AvatarScheme } from './cci/identity/avatar.js';
export type { AvatarSeed } from './cci/identity/avatar.js';

// Veritum Retrieval
export { VeritumRetriever } from './cci/veritum/veritumRetriever.js';
export type { GetVeritumOptions, VeritumRetrievalInterface } from './cci/veritum/veritumRetriever.js';

// Annotation Engine -- currently unused
// export { AnnotationEngine } from './cci/annotationEngine.js';

// Utility functions
export { deriveSigningKeypair, deriveEncryptionKeypair } from './cci/helpers/cryptography.js';
export { deriveIdentityMasterKey } from './cci/identity/identityUtil.js';

// Common types and definitions
export type { CciEncryptionParams, EncryptionRecipients } from './cci/veritum/encryption.definitions.js';

// Key utility
export { asCubeKey, asNotificationKey, keyVariants } from './core/cube/keyUtil.js';

// Core cube information (commonly needed)
export { CubeInfo } from './core/cube/cubeInfo.js';

// Error types that applications may need to catch
export * from './core/cube/coreCube.definitions.js';  // CubeError, FieldError, etc.
