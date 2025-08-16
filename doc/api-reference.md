# Verity API Reference

This document provides comprehensive reference documentation for the Verity API.

## Table of Contents

1. [Core Classes](#core-classes)
2. [Cube Management](#cube-management)
3. [Identity and Cryptography](#identity-and-cryptography)
4. [Common Cube Interface (CCI)](#common-cube-interface-cci)
5. [Application Utilities](#application-utilities)
6. [Constants and Enums](#constants-and-enums)

## Core Classes

### VerityNode

The main entry point for interacting with the Verity network.

```typescript
class VerityNode extends CoreNode {
  static async Create(options?: VerityNodeOptions): Promise<VerityNode>
  constructor(options?: VerityNodeOptions)
  
  readonly cubeStore: CubeStore
  readonly cubeRetriever: CubeRetriever
  readonly veritumRetriever: VeritumRetriever
  readonly networkManager: NetworkManager
  
  async shutdown(): Promise<void>
}
```

#### VerityNodeOptions

```typescript
interface VerityNodeOptions extends CoreNodeOptions {
  inMemory?: boolean                    // Use in-memory storage (default: false)
  lightNode?: boolean                   // Run as light node (default: false)  
  announceToTorrentTrackers?: boolean   // Announce to BitTorrent trackers (default: true)
  listenPort?: number                   // Port to listen on (default: random)
  persistenceDirectory?: string         // Directory for persistent storage
}
```

**Example:**
```typescript
// Create a light node with in-memory storage
const node = await VerityNode.Create({
  inMemory: true,
  lightNode: true,
  announceToTorrentTrackers: false
});
```

### CoreNode

Lower-level node interface (usually use VerityNode instead).

```typescript
class CoreNode {
  static async Create(options?: CoreNodeOptions): Promise<CoreNode>
  
  readonly cubeStore: CubeStore
  readonly cubeRetriever: CubeRetriever  
  readonly networkManager: NetworkManager
  readonly ready: boolean
  readonly readyPromise: Promise<void>
  
  async shutdown(): Promise<void>
}
```

## Cube Management

### Cube

The basic building block of Verity - a 1kB data container.

```typescript
class Cube {
  static Create(options?: CubeCreateOptions): Cube
  static Frozen(options: CubeCreateOptions): Cube
  static MUC(publicKey: Buffer, privateKey: Buffer, options?: CubeCreateOptions): Cube
  
  readonly cubeType: CubeType
  readonly binaryData: Buffer
  readonly fields: Fields
  
  async getKey(): Promise<CubeKey>
  async getKeyString(): Promise<string>
  getKeyIfAvailable(): CubeKey | undefined
  
  getFirstField(fieldType: number): Field | undefined
  verifySignature(): Promise<boolean>
  
  // Size and validation
  get isValid(): boolean
  get size(): number
}
```

#### CubeCreateOptions

```typescript
interface CubeCreateOptions {
  cubeType?: CubeType
  fields?: Field[]
  requiredDifficulty?: number
  family?: CubeFamilyDefinition
}
```

#### CubeType Enum

```typescript
enum CubeType {
  FROZEN = 0,        // Immutable, expires in 7 days
  PIC = 1,           // Immutable, extendable by anyone
  MUC = 2,           // Mutable by owner
  PMUC = 3,          // Mutable by owner, extendable by anyone
  FROZEN_NOTIFY = 4, // Frozen cube with notification
  MUC_NOTIFY = 6,    // MUC with notification
  PMUC_NOTIFY = 7    // PMUC with notification
}
```

**Example:**
```typescript
// Create a simple frozen cube
const cube = Cube.Frozen({
  fields: [
    { type: 0x10, value: Buffer.from('Hello World') }
  ]
});

// Get the cube's key
const key = await cube.getKey();
console.log('Cube key:', key.toString('hex'));
```

### cciCube

CCI-compliant cube with structured fields.

```typescript
class cciCube extends Cube {
  static Create(options?: CubeCreateOptions): cciCube
  static Frozen(options: CubeCreateOptions): cciCube
  static MUC(publicKey: Buffer, privateKey: Buffer, options?: CubeCreateOptions): cciCube
  
  readonly fields: VerityFields
  
  insertFieldBeforeBackPositionals(field: VerityField): void
  assertCci(): boolean
}
```

**Example:**
```typescript
import { cciCube, VerityField } from 'verity';

const cube = cciCube.Frozen({
  fields: [
    VerityField.Application('my-app'),
    VerityField.Payload('Hello CCI!')
  ]
});
```

### CubeStore

Storage and retrieval of cubes.

```typescript
class CubeStore {
  constructor(options: CubeStoreOptions)
  
  async addCube(cube: Cube | Buffer, options?: AddCubeOptions): Promise<Cube>
  async getCube(key: CubeKey | string): Promise<Cube>
  async getCubeInfo(key: CubeKey | string): Promise<CubeInfo>
  async hasCube(key: CubeKey | string): Promise<boolean>
  
  async getAllCubes(): AsyncGenerator<CubeInfo>
  async getNumberOfStoredCubes(): Promise<number>
  
  async shutdown(): Promise<void>
  
  // Events
  on(event: 'cubeAdded', listener: (cube: Cube) => void): this
  on(event: 'cubeUpdated', listener: (cube: Cube) => void): this
}
```

#### AddCubeOptions

```typescript
interface AddCubeOptions {
  fromNetwork?: boolean
  skipValidation?: boolean
}
```

**Example:**
```typescript
// Add a cube to storage
await node.cubeStore.addCube(cube);

// Check if cube exists
const exists = await node.cubeStore.hasCube(cubeKey);

// Retrieve a cube
const retrievedCube = await node.cubeStore.getCube(cubeKey);

// Listen for new cubes
node.cubeStore.on('cubeAdded', (cube) => {
  console.log('New cube added:', cube.getKeyIfAvailable()?.toString('hex'));
});
```

### CubeRetriever

Request cubes from the network.

```typescript
class CubeRetriever {
  async requestCube(key: CubeKey, options?: CubeRequestOptions): Promise<CubeInfo>
  async requestNotifications(key: NotificationKey): Promise<CubeInfo>
  
  async shutdown(): Promise<void>
}
```

## Identity and Cryptography

### Identity

Cryptographic identity for users.

```typescript
class Identity {
  static async Create(options?: IdentityOptions): Promise<Identity>
  static async Load(keyData: IdentityKeyData, options?: IdentityOptions): Promise<Identity>
  
  readonly name: string
  readonly publicKey: Buffer
  readonly publicKeyString: string
  
  async getKeypair(): Promise<{ publicKey: Buffer, privateKey: Buffer }>
  
  // Content creation
  async createMUC(options: CubeCreateOptions): Promise<cciCube>
  async createEncryptedCube(content: string, recipients: Buffer[]): Promise<cciCube>
  
  // Content management
  addPost(cubeKey: CubeKey): void
  getPostKeyStrings(): Set<string>
  async getPosts(options?: GetPostsOptions): AsyncGenerator<PostInfo>
  
  // Subscriptions
  addPublicSubscription(publicKey: Buffer): void
  hasPublicSubscription(publicKey: Buffer): boolean
  getPublicSubscriptions(): Set<string>
  
  // Persistence
  async store(): Promise<void>
  
  // Encryption
  async decryptCube(cube: cciCube): Promise<string>
}
```

#### IdentityOptions

```typescript
interface IdentityOptions {
  name?: string
  cubeStore?: CubeStore
  cubeRetriever?: CubeRetriever
  veritumRetriever?: VeritumRetriever
  identityStore?: IdentityStore
  idmucNotificationKey?: NotificationKey
}
```

**Example:**
```typescript
// Create a new identity
const identity = await Identity.Create({
  name: 'Alice',
  cubeStore: node.cubeStore
});

// Create signed content
const signedCube = await identity.createMUC({
  fields: [
    VerityField.Application('my-app'),
    VerityField.Username(identity.name),
    VerityField.Payload('Signed message')
  ]
});

// Subscribe to another user
identity.addPublicSubscription(bobsPublicKey);

// Store the identity
await identity.store();
```

### IdentityStore

Manage multiple identities.

```typescript
class IdentityStore {
  constructor(cubeStore: CubeStore)
  
  async addIdentity(identity: Identity): Promise<void>
  async getIdentity(publicKey: string | Buffer): Promise<Identity | undefined>
  async getAllIdentities(): Promise<Identity[]>
  
  async shutdown(): Promise<void>
}
```

## Common Cube Interface (CCI)

### VerityField

Factory for creating CCI fields.

```typescript
class VerityField {
  static Application(value: string): VerityField
  static Payload(value: string | Buffer): VerityField
  static ContentName(value: string): VerityField
  static Description(value: string): VerityField
  static Username(value: string): VerityField
  static MediaType(value: number): VerityField
  static Date(purpose: number, timestamp: number): VerityField
  static RelatesTo(relationship: Relationship): VerityField
  static Notify(key: NotificationKey): VerityField
  static Avatar(scheme: number, data: Buffer): VerityField
  
  readonly type: number
  readonly value: Buffer
  readonly length?: number
}
```

#### MediaTypes Enum

```typescript
enum MediaTypes {
  TEXT = 1,
  JPEG = 2
}
```

### Relationship

Defines relationships between cubes.

```typescript
class Relationship {
  constructor(type: RelationshipType, targetKey: CubeKey)
  static fromKeys(type: RelationshipType, keys: string[]): Relationship[]
  
  readonly type: RelationshipType
  readonly targetKey: CubeKey
}
```

#### RelationshipType Enum

```typescript
enum RelationshipType {
  CONTINUED_IN = 1,
  INTERPRETS = 2,
  REPLY_TO = 3,
  QUOTATION = 4,
  MYPOST = 5,
  MENTION = 6,
  AUTHORHINT = 7,
  REPLACED_BY = 11,
  ILLUSTRATION = 71,
  KEY_BACKUP_CUBE = 72,
  SUBSCRIPTION_RECOMMENDATION_INDEX = 73,
  SUBSCRIPTION_RECOMMENDATION = 81
}
```

### FieldType Enum

```typescript
enum FieldType {
  // Core CCI fields (0x00-0x0F)
  CCI_END = 0x00,
  APPLICATION = 0x01,
  ENCRYPTED_CONTENT = 0x02,
  ENCRYPTION_NONCE = 0x03,
  ENCRYPTION_MAC = 0x04,
  ENCRYPTED_SYMMETRIC_KEY = 0x05,
  ENCRYPTION_PUBLIC_KEY = 0x06,
  MUC_PMUC_KDF_HINT = 0x07,
  DATE = 0x0A,
  
  // Content-descriptive fields (0x10-0x1F)
  PAYLOAD = 0x10,
  CONTENT_NAME = 0x11,
  DESCRIPTION = 0x12,
  RELATES_TO = 0x13,
  USERNAME = 0x14,
  MEDIA_TYPE = 0x15,
  AVATAR = 0x16,
  
  // Application-specific fields (0x30-0x3F)
  // Your application can define custom fields in this range
}
```

**Example:**
```typescript
// Create various CCI fields
const fields = [
  VerityField.Application('chat-app'),
  VerityField.Username('Alice'),
  VerityField.MediaType(MediaTypes.TEXT),
  VerityField.Payload('Hello everyone!'),
  VerityField.Date(1, Math.floor(Date.now() / 1000)),
  VerityField.RelatesTo(new Relationship(RelationshipType.REPLY_TO, parentKey))
];

const cube = cciCube.Frozen({ fields });
```

### VerityFields

Container for CCI fields in a cube.

```typescript
class VerityFields {
  get(fieldType: FieldType): VerityField[] | undefined
  getFirst(fieldType: FieldType): VerityField | undefined
  has(fieldType: FieldType): boolean
  
  insertTillFull(fields: VerityField[]): number
  bytesRemaining(): number
  
  readonly size: number
}
```

## Application Utilities

### makePost

Utility for creating microblog posts (from ZW application).

```typescript
async function makePost(
  text: string, 
  options?: MakePostOptions
): Promise<cciCube>
```

#### MakePostOptions

```typescript
interface MakePostOptions {
  replyto?: CubeKey      // Key of post being replied to
  id?: Identity          // Identity of the poster
  requiredDifficulty?: number
  store?: CubeStore      // Automatically add to store
}
```

**Example:**
```typescript
// Create a post
const post = await makePost('Hello Verity!', {
  id: identity,
  store: node.cubeStore
});

// Create a reply
const reply = await makePost('Nice to meet you!', {
  id: identity,
  replyto: await post.getKey(),
  store: node.cubeStore  
});
```

### ChatApplication

Utility for chat applications.

```typescript
class ChatApplication {
  static async createChatCube(
    username: string, 
    message: string, 
    notificationKey: NotificationKey
  ): Promise<cciCube>
  
  static parseChatCube(cube: cciCube): {
    username: string,
    message: string, 
    notificationKey: Buffer
  }
}
```

**Example:**
```typescript
// Create a chat room
const chatRoomKey = Buffer.alloc(32);
crypto.randomFillSync(chatRoomKey);

// Send a message
const chatCube = await ChatApplication.createChatCube(
  'Alice',
  'Hello everyone!',
  chatRoomKey
);
await node.cubeStore.addCube(chatCube);

// Parse received message
const { username, message } = ChatApplication.parseChatCube(chatCube);
console.log(`${username}: ${message}`);
```

### FileApplication

Utility for file sharing.

```typescript
class FileApplication {
  static async createFileCubes(
    fileContent: Buffer,
    fileName: string,
    progressCallback?: (progress: number, remainingSize: number) => void
  ): Promise<cciCube[]>
  
  static async retrieveFile(
    firstCube: cciCube,
    cubeStore: CubeStore
  ): Promise<Buffer>
}
```

**Example:**
```typescript
// Share a file
const fileData = fs.readFileSync('document.pdf');
const fileCubes = await FileApplication.createFileCubes(
  fileData,
  'document.pdf',
  (progress, remaining) => {
    console.log(`Progress: ${progress}%`);
  }
);

// Store all cubes
for (const cube of fileCubes) {
  await node.cubeStore.addCube(cube);
}

// Retrieve the file
const reconstructed = await FileApplication.retrieveFile(
  fileCubes[0],
  node.cubeStore
);
```

## Constants and Enums

### Network Constants

```typescript
const NetConstants = {
  CUBE_SIZE: 1024,           // Size of each cube in bytes
  CUBE_KEY_SIZE: 32,         // Size of cube keys in bytes
  NOTIFY_SIZE: 32,           // Size of notification keys in bytes
  PUBLIC_KEY_SIZE: 32,       // Size of public keys in bytes
  PRIVATE_KEY_SIZE: 64,      // Size of private keys in bytes
  SIGNATURE_SIZE: 64,        // Size of signatures in bytes
  DEFAULT_DIFFICULTY: 0      // Default proof-of-work difficulty
};
```

### Buffer Types

```typescript
type CubeKey = Buffer;           // 32-byte cube identifier
type NotificationKey = Buffer;   // 32-byte notification key
type PublicKey = Buffer;         // 32-byte Ed25519 public key
type PrivateKey = Buffer;        // 64-byte Ed25519 private key
```

### Error Classes

```typescript
class CubeError extends Error {
  constructor(message: string)
}

class FieldError extends Error {
  constructor(message: string)  
}

class FieldSizeError extends FieldError {
  constructor(message: string)
}

class VerityError extends Error {
  constructor(message: string)
}
```

## Usage Patterns

### Basic Application Setup

```typescript
import { VerityNode, Identity, cciCube, VerityField } from 'verity';

class MyApp {
  private node: VerityNode;
  private identity: Identity;
  
  async init() {
    this.node = await VerityNode.Create({ inMemory: true });
    this.identity = await Identity.Create({
      cubeStore: this.node.cubeStore,
      name: 'AppUser'
    });
  }
  
  async createContent(data: string) {
    const cube = cciCube.Frozen({
      fields: [
        VerityField.Application('my-app'),
        VerityField.Payload(data)
      ]
    });
    
    await this.node.cubeStore.addCube(cube);
    return cube;
  }
  
  async shutdown() {
    await this.node.shutdown();
  }
}
```

### Event-Driven Application

```typescript
// Listen for new cubes
node.cubeStore.on('cubeAdded', (cube) => {
  const appField = cube.getFirstField(FieldType.APPLICATION);
  if (appField?.value.toString() === 'my-app') {
    const payload = cube.getFirstField(FieldType.PAYLOAD);
    console.log('New content:', payload.value.toString());
  }
});

// Request notifications
const notificationKey = Buffer.alloc(32, 'my-notifications');
node.cubeRetriever.requestNotifications(notificationKey).then(cubeInfo => {
  console.log('Notification received:', cubeInfo.keyString);
});
```

This API reference covers the main classes and functions you'll use when building applications on Verity. For more examples and detailed guides, see the [Developer Guide](developer-guide.md).