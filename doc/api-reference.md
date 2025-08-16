# Verity API Reference

This document provides comprehensive reference documentation for the Verity API, focusing on the high-level interfaces most developers will use.

## Table of Contents

1. [Core Classes](#core-classes)
2. [Common Cube Interface (CCI)](#common-cube-interface-cci)
3. [Veritum for Large Data](#veritum-for-large-data)
4. [Application APIs](#application-apis)
5. [Identity and Cryptography](#identity-and-cryptography)
6. [Low-Level Cube Management](#low-level-cube-management)
7. [Constants and Enums](#constants-and-enums)

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

## Common Cube Interface (CCI)

CCI provides the primary interface for structured data in Verity applications.

### cciCube

The main class for working with structured cubes.

```typescript
class cciCube extends Cube {
  static Frozen(options: CciCubeCreateOptions): cciCube
  static MUC(publicKey: Buffer, privateKey: Buffer, options?: CciCubeCreateOptions): cciCube
  static PIC(options: CciCubeCreateOptions): cciCube
  static PMUC(publicKey: Buffer, privateKey: Buffer, options?: CciCubeCreateOptions): cciCube

  readonly fields: VerityFields
  readonly fieldParser: FieldParser

  insertFieldBeforeBackPositionals(field: VerityField): void
  getFirstField(fieldType: FieldType): Field | undefined
  getAllFields(fieldType: FieldType): Field[]
}
```

#### CciCubeCreateOptions

```typescript
interface CciCubeCreateOptions {
  fields: VerityField[]
  cubeType?: CubeType
}
```

**Example:**
```typescript
const cube = cciCube.Frozen({
  fields: [
    VerityField.Application('my-app'),
    VerityField.Username('Alice'),
    VerityField.Payload('Hello, world!')
  ]
});
```

### VerityField

Factory class for creating standardized fields.

```typescript
class VerityField {
  // Content fields
  static Application(identifier: string): Field
  static Payload(data: string | Buffer): Field
  static ContentName(name: string): Field
  static Description(text: string): Field
  static MediaType(type: MediaType): Field

  // Identity fields  
  static Username(name: string): Field
  static PublicKey(key: Buffer): Field
  static Signature(sig: Buffer): Field

  // Temporal fields
  static Timestamp(date: Date): Field
  static Date(timeType: number, unixTimestamp: number): Field

  // Relationship fields
  static RelatesTo(relationship: Relationship): Field
  static Notify(notificationKey: Buffer): Field

  // Advanced fields
  static EncryptedPayload(data: Buffer): Field
  static KeyChunk(keyData: Buffer): Field
  static RecipientPublicKey(key: Buffer): Field
}
```

**Example:**
```typescript
const fields = [
  VerityField.Application('chat-app'),
  VerityField.Username('Alice'),
  VerityField.Payload('Hello!'),
  VerityField.Timestamp(new Date())
];
```

### Relationship

Links between cubes for creating structured data relationships.

```typescript
class Relationship {
  constructor(type: RelationshipType, targetKey: CubeKey)
  
  readonly type: RelationshipType
  readonly targetKey: CubeKey
}

enum RelationshipType {
  REPLY_TO = 0x01,
  CONTINUED_IN = 0x02,
  RELATES_TO = 0x03,
  SUPERSEDES = 0x04,
  REFERENCES = 0x05
}
```

**Example:**
```typescript
const replyRelationship = new Relationship(
  RelationshipType.REPLY_TO,
  await originalMessage.getKey()
);

const reply = cciCube.Frozen({
  fields: [
    VerityField.Application('chat-app'),
    VerityField.RelatesTo(replyRelationship),
    VerityField.Payload('This is a reply')
  ]
});
```

## Veritum for Large Data

Veritum handles data larger than what fits in a single cube by automatically splitting and recombining.

### Veritum

```typescript
class Veritum extends VeritableBaseImplementation {
  static Create(options: VeritumCreateOptions): Veritum
  static FromChunks(chunks: Iterable<cciCube>, options?: VeritumFromChunksOptions): Veritum

  readonly chunks: Iterable<cciCube>
  readonly fields: VerityFields
  readonly publicKey: Buffer
  readonly privateKey: Buffer

  async compile(): Promise<cciCube[]>
  getFirstField(fieldType: FieldType): Field | undefined
}
```

#### VeritumCreateOptions

```typescript
interface VeritumCreateOptions extends VeritumCompileOptions {
  chunks?: cciCube[]
}

interface VeritumCompileOptions extends CubeCreateOptions, CciEncryptionParams {
  fields: VerityField[]
  publicKey?: Buffer
  privateKey?: Buffer
}
```

**Example:**
```typescript
// Create a Veritum for large content
const largeContent = Buffer.from('Very long content...'.repeat(1000));

const veritum = Veritum.Create({
  fields: [
    VerityField.Application('document-app'),
    VerityField.ContentName('large-document.txt'),
    VerityField.Payload(largeContent)
  ]
});

// Compile into cubes
const cubes = await veritum.compile();
for (const cube of cubes) {
  await node.cubeStore.addCube(cube);
}

// Reconstruct from cubes
const reconstructed = Veritum.FromChunks(cubes);
const originalContent = reconstructed.getFirstField(FieldType.PAYLOAD);
```

### VeritumRetriever

High-level interface for retrieving and reconstructing Veritum data.

```typescript
class VeritumRetriever {
  constructor(cubeRetriever: CubeRetriever)

  async getVeritum(key: CubeKey | string, options?: RetrievalOptions): Promise<Veritum | null>
  async subscribeNotifications(notificationKey: Buffer, callback: (veritum: Veritum) => void): Promise<void>
}
```

**Example:**
```typescript
const veritum = await node.veritumRetriever.getVeritum(veritumKey);
if (veritum) {
  const content = veritum.getFirstField(FieldType.PAYLOAD);
  console.log('Retrieved large content:', content.valueBuffer);
}
```

## Application APIs

High-level APIs for common application patterns.

### ChatApplication

Ready-to-use API for messaging applications.

```typescript
class ChatApplication {
  static async createChatCube(
    username: string, 
    message: string, 
    notificationKey: Buffer
  ): Promise<cciCube>

  static parseChatCube(cube: cciCube): {
    username: string
    message: string
    notificationKey: Buffer
  }
}
```

**Example:**
```typescript
// Send a message
const notificationKey = Buffer.alloc(32); // Your routing key
const chatCube = await ChatApplication.createChatCube(
  'Alice',
  'Hello everyone!',
  notificationKey
);
await node.cubeStore.addCube(chatCube);

// Parse received messages
const parsed = ChatApplication.parseChatCube(chatCube);
console.log(`${parsed.username}: ${parsed.message}`);
```

### FileApplication

Ready-to-use API for file storage and sharing.

```typescript
class FileApplication {
  static async createFileCubes(
    fileContent: Buffer,
    fileName: string,
    progressCallback?: (progress: number, remainingSize: number) => void
  ): Promise<cciCube[]>

  static async reconstructFile(cubes: cciCube[]): Promise<{
    fileName: string
    content: Buffer
  }>
}
```

**Example:**
```typescript
// Store a file
const fileContent = await fs.readFile('document.pdf');
const fileCubes = await FileApplication.createFileCubes(
  fileContent,
  'document.pdf',
  (progress, remaining) => {
    console.log(`Progress: ${progress}%, ${remaining} bytes remaining`);
  }
);

// Add to network
for (const cube of fileCubes) {
  await node.cubeStore.addCube(cube);
}

// Reconstruct file
const file = await FileApplication.reconstructFile(fileCubes);
await fs.writeFile('downloaded.pdf', file.content);
```

## Identity and Cryptography

### Identity

Manages cryptographic identities for signing and encryption.

```typescript
class Identity {
  static async Create(options?: IdentityCreateOptions): Promise<Identity>
  static async Load(publicKeyString: string): Promise<Identity>

  readonly name: string
  readonly publicKeyString: string
  readonly store: IdentityStore

  async getKeypair(): Promise<{ publicKey: Buffer, privateKey: Buffer }>
  async createMUC(options: CciCubeCreateOptions): Promise<cciCube>
  async createPMUC(options: CciCubeCreateOptions): Promise<cciCube>
  async sign(data: Buffer): Promise<Buffer>
  async encrypt(data: Buffer, recipientPublicKey: Buffer): Promise<Buffer>
  async decrypt(encryptedData: Buffer): Promise<Buffer>
}
```

#### IdentityCreateOptions

```typescript
interface IdentityCreateOptions {
  name?: string
  persistenceDirectory?: string
  inMemory?: boolean
}
```

**Example:**
```typescript
// Create identity
const identity = await Identity.Create({ name: 'Alice' });

// Create signed content
const signedCube = await identity.createMUC({
  fields: [
    VerityField.Application('my-app'),
    VerityField.Payload('Signed content')
  ]
});

// Verify signature
const isValid = await signedCube.verifySignature();
```

### IdentityStore

Manages persistent storage of identities.

```typescript
class IdentityStore {
  async save(): Promise<void>
  async load(publicKeyString: string): Promise<Identity | null>
  async list(): Promise<string[]>
  async delete(publicKeyString: string): Promise<void>
}
```

## Low-Level Cube Management

*Note: Most applications should use CCI and Veritum APIs instead.*

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

  get isValid(): boolean
  get size(): number
}
```

### CubeStore

Local storage for cubes.

```typescript
class CubeStore extends EventEmitter {
  async addCube(cube: Cube): Promise<void>
  async getCube(key: CubeKey | string): Promise<Cube | null>
  async hasCube(key: CubeKey | string): Promise<boolean>
  async removeCube(key: CubeKey | string): Promise<void>
  async getAllCubes(): Promise<Cube[]>

  // Events
  on(event: 'cubeAdded', listener: (cube: Cube) => void): this
  on(event: 'cubeRemoved', listener: (key: CubeKey) => void): this
}
```

### CubeRetriever

Network retrieval of cubes.

```typescript
class CubeRetriever {
  async getCube(key: CubeKey | string): Promise<Cube | null>
  async requestCube(key: CubeKey | string): Promise<void>
  async subscribeNotifications(notificationKey: Buffer, callback: (cube: Cube) => void): Promise<void>
}
```

## Constants and Enums

### CubeType

```typescript
enum CubeType {
  FROZEN = 0x00,
  FROZEN_NOTIFY = 0x01,
  MUC = 0x10,
  MUC_NOTIFY = 0x11,
  PIC = 0x20,
  PIC_NOTIFY = 0x21,
  PMUC = 0x30,
  PMUC_NOTIFY = 0x31
}
```

### FieldType

```typescript
enum FieldType {
  APPLICATION = 0x01,
  PAYLOAD = 0x02,
  CONTENT_NAME = 0x03,
  USERNAME = 0x04,
  PUBLIC_KEY = 0x05,
  SIGNATURE = 0x06,
  TIMESTAMP = 0x07,
  RELATES_TO = 0x08,
  NOTIFY = 0x09,
  ENCRYPTED_PAYLOAD = 0x0A,
  KEY_CHUNK = 0x0B,
  RECIPIENT_PUBLIC_KEY = 0x0C,
  // ... and more
}
```

### MediaType

```typescript
enum MediaType {
  TEXT = 'text/plain',
  HTML = 'text/html',
  JSON = 'application/json',
  BINARY = 'application/octet-stream',
  IMAGE_PNG = 'image/png',
  IMAGE_JPEG = 'image/jpeg',
  // ... and more
}
```

This API reference covers the main interfaces developers will use when building applications on Verity. For more practical examples, see the [Developer Guide](developer-guide.md) and the working applications in `src/app/`.