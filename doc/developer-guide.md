# Verity Developer Guide

This guide will help you build applications on top of the Verity platform. Verity is a decentralized data storage and distribution platform that uses unique "cube" structures for peer-to-peer applications.

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [Getting Started](#getting-started)
3. [Using the Common Cube Interface (CCI)](#using-the-common-cube-interface-cci)
4. [Working with Veritum for Large Data](#working-with-veritum-for-large-data)
5. [Application-Level APIs](#application-level-apis)
6. [Identity Management](#identity-management)
7. [Building Applications](#building-applications)
8. [Examples](#examples)
9. [Best Practices](#best-practices)

## Core Concepts

### Cubes
Cubes are the fundamental building blocks of Verity. Each cube contains exactly 1kB of data and has a unique key derived from its content. However, for most application development, you'll work with higher-level abstractions rather than manipulating cubes directly.

### Common Cube Interface (CCI)
CCI provides a standardized way to structure data within cubes using a Type-Length-Value (TLV) format. This is the primary interface for most application development, enabling interoperability between different applications.

### Veritum
Veritum handles large data that doesn't fit in a single cube by automatically splitting it across multiple cubes and providing seamless reconstruction. This is ideal for files, large messages, or any data over 1kB.

### Application-Level APIs
Verity includes ready-to-use application APIs for common use cases:
- **ChatApplication**: For messaging and communication
- **FileApplication**: For file storage and sharing

### Identities
Identities are cryptographic keypairs that allow users to:
- Sign and authenticate content
- Receive encrypted messages
- Maintain a persistent identity across the network

### Nodes
- **Full Nodes**: Store all cubes in the network
- **Light Nodes**: Only store cubes they need

## Getting Started

### Installation and Setup

```bash
# Clone the repository
git clone https://github.com/EliasOenal/verity.git
cd verity

# Install dependencies (takes ~8 minutes)
npm install

# Build the project
npm run build
```

### Basic Setup

```typescript
import { VerityNode, Identity } from './src/index.js';

// Create a node (light node by default)
const node = await VerityNode.Create({
  inMemory: true,  // Use in-memory storage for testing
  lightNode: true  // Don't replicate all network data
});

// Create an identity
const identity = await Identity.Create();
console.log('Identity created:', identity.publicKeyString);
```

## Using the Common Cube Interface (CCI)

CCI is the primary interface for structuring data in Verity. It provides a standardized Type-Length-Value (TLV) format that ensures interoperability between applications.

### Creating Structured Data with CCI

```typescript
import { cciCube, VerityField } from './src/index.js';

// Create a simple structured message
const messageCube = cciCube.Frozen({
  fields: [
    VerityField.Application('my-app'),
    VerityField.Username('Alice'),
    VerityField.Payload('Hello, Verity!')
  ]
});

await node.cubeStore.addCube(messageCube);
```

### Available Field Types

CCI supports many standardized field types:

```typescript
// Common field types
VerityField.Application('app-name')           // Application identifier
VerityField.Username('alice')                 // User name
VerityField.Payload('message content')        // Main content
VerityField.ContentName('filename.txt')       // File or content name
VerityField.Timestamp(new Date())             // Timestamp
VerityField.RelatesTo(relationship)           // Links to other cubes
VerityField.Notify(notificationKey)           // Notification routing

// Identity and cryptography
VerityField.PublicKey(keyBuffer)              // Public key
VerityField.Signature(signatureBuffer)        // Digital signature

// Advanced
VerityField.EncryptedPayload(encryptedData)   // Encrypted content
VerityField.KeyChunk(keyData)                 // Encryption key fragment
```

### Working with Relationships

CCI allows linking cubes together:

```typescript
import { Relationship, RelationshipType } from './src/index.js';

// Create a reply to another cube
const originalCubeKey = await originalCube.getKey();
const replyCube = cciCube.Frozen({
  fields: [
    VerityField.Application('my-app'),
    VerityField.RelatesTo(new Relationship(
      RelationshipType.REPLY_TO, 
      originalCubeKey
    )),
    VerityField.Payload('This is a reply')
  ]
});
```

## Working with Veritum for Large Data

Veritum automatically handles data larger than what fits in a single cube by splitting it across multiple cubes.

### Creating a Veritum

```typescript
import { Veritum, VerityField } from './src/index.js';

// Create a large document
const largeContent = Buffer.from('A very long document...'.repeat(1000));

const veritum = Veritum.Create({
  fields: [
    VerityField.Application('document-app'),
    VerityField.ContentName('large-document.txt'),
    VerityField.Payload(largeContent)
  ]
});

// Compile into multiple cubes automatically
const cubes = await veritum.compile();
for (const cube of cubes) {
  await node.cubeStore.addCube(cube);
}
```

### Retrieving and Reconstructing Veritum

```typescript
// Retrieve all chunks and reconstruct
const retrievedCubes = /* fetch cubes from network */;
const reconstructed = Veritum.FromChunks(retrievedCubes);

// Access the original data
const content = reconstructed.getFirstField(FieldType.PAYLOAD);
```

## Application-Level APIs

For most common use cases, Verity provides ready-to-use application APIs.

### Chat Application

```typescript
import { ChatApplication } from './src/index.js';

// Create a chat message
const notificationKey = Buffer.alloc(32); // Your notification routing key
const chatCube = await ChatApplication.createChatCube(
  'Alice',           // username
  'Hello everyone!', // message
  notificationKey    // notification routing
);

await node.cubeStore.addCube(chatCube);

// Parse received chat messages
const parsed = ChatApplication.parseChatCube(chatCube);
console.log(`${parsed.username}: ${parsed.message}`);
```

### File Application

```typescript
import { FileApplication } from './src/index.js';

// Store a file
const fileContent = await fs.readFile('document.pdf');
const fileCubes = await FileApplication.createFileCubes(
  fileContent, 
  'document.pdf',
  (progress, remaining) => {
    console.log(`Upload progress: ${progress}%, ${remaining} bytes remaining`);
  }
);

// Add all file cubes to storage
for (const cube of fileCubes) {
  await node.cubeStore.addCube(cube);
}

// Reconstruct file from cubes
const reconstructed = await FileApplication.reconstructFile(fileCubes);
await fs.writeFile('downloaded-document.pdf', reconstructed.content);
```

## Identity Management

### Creating and Managing Identities

```typescript
import { Identity } from './src/index.js';

// Create a new identity
const identity = await Identity.Create({
  name: 'Alice'
});

// Save identity to storage
await identity.store.save();

// Load existing identity
const loadedIdentity = await Identity.Load(identity.publicKeyString);

// Create signed content
const signedCube = await identity.createMUC({
  fields: [
    VerityField.Application('my-app'),
    VerityField.Payload('Signed content')
  ]
});
```

### Working with Signed Content

```typescript
// Verify signatures
const isValid = await signedCube.verifySignature();

// Get the signing identity
const signerKey = signedCube.getFirstField(FieldType.PUBLIC_KEY);
```

## Building Applications

### Application Structure

```typescript
// my-app/index.ts
import { VerityNode, Identity, cciCube, VerityField } from '../verity/src/index.js';

export class MyApplication {
  private node: VerityNode;
  private identity: Identity;

  constructor(node: VerityNode, identity: Identity) {
    this.node = node;
    this.identity = identity;
  }

  async createPost(content: string): Promise<void> {
    const postCube = cciCube.Frozen({
      fields: [
        VerityField.Application('my-social-app'),
        VerityField.Username(this.identity.name),
        VerityField.Payload(content),
        VerityField.Timestamp(new Date())
      ]
    });

    await this.node.cubeStore.addCube(postCube);
  }

  async getPosts(): Promise<string[]> {
    // Implementation would retrieve and filter cubes
    // This is a simplified example
    return [];
  }
}
```

### Handling Network Events

```typescript
// Listen for new cubes
node.cubeStore.on('cubeAdded', (cube) => {
  console.log('New cube received:', cube.getKeyIfAvailable());
});

// Handle network connections
node.networkManager.on('peerConnected', (peerId) => {
  console.log('Peer connected:', peerId);
});
```

## Examples

### Simple Messaging App

```typescript
import { VerityNode, Identity, ChatApplication } from './src/index.js';

class SimpleMessenger {
  private node: VerityNode;
  private identity: Identity;
  private notificationKey: Buffer;

  constructor(node: VerityNode, identity: Identity) {
    this.node = node;
    this.identity = identity;
    this.notificationKey = Buffer.alloc(32); // Configure your routing
  }

  async sendMessage(message: string): Promise<void> {
    const chatCube = await ChatApplication.createChatCube(
      this.identity.name,
      message,
      this.notificationKey
    );
    await this.node.cubeStore.addCube(chatCube);
  }

  async receiveMessages(): Promise<void> {
    this.node.cubeStore.on('cubeAdded', (cube) => {
      try {
        const parsed = ChatApplication.parseChatCube(cube);
        console.log(`${parsed.username}: ${parsed.message}`);
      } catch (e) {
        // Not a chat cube, ignore
      }
    });
  }
}
```

### File Sharing Service

```typescript
import { VerityNode, FileApplication } from './src/index.js';

class FileShare {
  private node: VerityNode;

  constructor(node: VerityNode) {
    this.node = node;
  }

  async shareFile(filePath: string): Promise<string[]> {
    const content = await fs.readFile(filePath);
    const fileName = path.basename(filePath);
    
    const fileCubes = await FileApplication.createFileCubes(
      content,
      fileName,
      (progress) => console.log(`Upload: ${progress}%`)
    );

    const cubeKeys = [];
    for (const cube of fileCubes) {
      await this.node.cubeStore.addCube(cube);
      cubeKeys.push(await cube.getKeyString());
    }

    return cubeKeys; // Share these keys with others
  }

  async downloadFile(cubeKeys: string[], outputPath: string): Promise<void> {
    const cubes = [];
    for (const keyString of cubeKeys) {
      const cube = await this.node.cubeRetriever.getCube(keyString);
      if (cube) cubes.push(cube);
    }

    const file = await FileApplication.reconstructFile(cubes);
    await fs.writeFile(outputPath, file.content);
  }
}
```

## Best Practices

### Performance

- **Use light nodes** for applications that don't need to store all network data
- **Batch operations** when adding multiple cubes
- **Use Veritum** for large data rather than creating many small cubes
- **Cache frequently accessed cubes** locally

### Security

- **Always verify signatures** on received content
- **Use proper encryption** for sensitive data
- **Validate input data** before creating cubes
- **Keep private keys secure** and never log them

### Data Design

- **Use appropriate field types** to ensure interoperability
- **Include application identifiers** to enable filtering
- **Use relationships** to link related content
- **Consider data lifetime** when choosing cube types

### Development

- **Start with in-memory nodes** for testing
- **Use the application APIs** rather than low-level cube manipulation
- **Test network connectivity** in a local environment first
- **Monitor cube storage usage** in production applications

This guide provides the foundation for building applications on Verity. For more detailed API documentation, see the [API Reference](api-reference.md), and for working examples, explore the applications in `src/app/`.