# Verity Developer Guide

This guide will help you build applications on top of the Verity platform. Verity is a decentralized data storage and distribution platform that uses unique "cube" structures for peer-to-peer applications.

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [Getting Started](#getting-started)
3. [Working with Cubes](#working-with-cubes)
4. [Using the Common Cube Interface (CCI)](#using-the-common-cube-interface-cci)
5. [Identity Management](#identity-management)
6. [Building Applications](#building-applications)
7. [Examples](#examples)
8. [Best Practices](#best-practices)
9. [Troubleshooting](#troubleshooting)

## Core Concepts

### Cubes
Cubes are the fundamental building blocks of Verity. Each cube contains exactly 1kB of data and has a unique key derived from its content. There are several types of cubes:

- **Frozen Cubes**: Immutable cubes with a limited lifespan (7 days by default)
- **MUCs (Mutable User Cubes)**: Cubes that can be updated by their owner
- **PICs (Immutable Persistence Cubes)**: Immutable cubes whose lifespan can be extended by anyone
- **PMUCs**: Combination of MUCs and PICs features

### Common Cube Interface (CCI)
CCI provides a standardized way to structure data within cubes using a Type-Length-Value (TLV) format. This enables interoperability between different applications.

### Identities
Identities are cryptographic keypairs that allow users to:
- Sign and authenticate content
- Receive encrypted messages
- Maintain a persistent identity across the network

### Nodes
- **Full Nodes**: Store all cubes in the network
- **Light Nodes**: Only store cubes they need

## Getting Started

### Installation

```bash
npm install verity
```

### Basic Setup

```typescript
import { VerityNode, Identity, cciCube, VerityField } from 'verity';

// Create a node (light node by default)
const node = await VerityNode.Create({
  inMemory: true,  // Use in-memory storage for testing
  lightNode: true  // Don't replicate all network data
});

// Create an identity
const identity = await Identity.Create();
console.log('Identity created:', identity.publicKeyString);
```

### Creating Your First Cube

```typescript
// Create a simple text cube
const cube = cciCube.Frozen({
  fields: [
    VerityField.Application('my-app'),
    VerityField.Payload('Hello, Verity!')
  ]
});

// Add it to the node's storage
await node.cubeStore.addCube(cube);
console.log('Cube created with key:', await cube.getKeyString());
```

## Working with Cubes

### Creating Different Types of Cubes

```typescript
import { CubeType, VerityField, cciCube } from 'verity';

// Frozen cube (immutable, expires in 7 days)
const frozenCube = cciCube.Frozen({
  fields: [
    VerityField.Application('my-app'),
    VerityField.Payload('This is immutable content')
  ]
});

// MUC (updatable by owner)
const { publicKey, privateKey } = await identity.getKeypair();
const muc = cciCube.MUC(publicKey, privateKey, {
  fields: [
    VerityField.Application('my-app'),
    VerityField.Username('Alice'),
    VerityField.Payload('This content can be updated')
  ]
});
```

### Retrieving Cubes

```typescript
// Get a cube by its key
const cubeKey = await cube.getKey();
const retrievedCube = await node.cubeStore.getCube(cubeKey);

// Check if a cube exists
const exists = await node.cubeStore.hasCube(cubeKey);
```

## Using the Common Cube Interface (CCI)

### Standard Fields

CCI defines standard fields that all applications can understand:

```typescript
import { VerityField, MediaTypes, RelationshipType, Relationship } from 'verity';

const cube = cciCube.Frozen({
  fields: [
    // Application identifier
    VerityField.Application('my-chat-app'),
    
    // Content description
    VerityField.ContentName('Chat message'),
    VerityField.Description('A message in the chat room'),
    
    // Media type
    VerityField.MediaType(MediaTypes.TEXT),
    
    // Main content
    VerityField.Payload('Hello everyone!'),
    
    // User information
    VerityField.Username('Alice'),
    
    // Relationships to other cubes
    VerityField.RelatesTo(new Relationship(
      RelationshipType.REPLY_TO,
      parentMessageKey
    )),
    
    // Timestamp
    VerityField.Date(1, Date.now() / 1000) // 1 = creation time
  ]
});
```

### Reading Field Data

```typescript
import { FieldType } from 'verity';

// Get the first field of a specific type
const payload = cube.getFirstField(FieldType.PAYLOAD);
const payloadText = payload.value.toString();

// Get all fields of a specific type
const allRelationships = cube.fields.get(FieldType.RELATES_TO);

// Check if a field exists
const hasUsername = cube.fields.has(FieldType.USERNAME);
```

## Identity Management

### Creating and Managing Identities

```typescript
import { Identity, IdentityStore } from 'verity';

// Create a new identity
const identity = await Identity.Create({
  cubeStore: node.cubeStore,
  name: 'Alice'
});

// Store the identity
const identityStore = new IdentityStore(node.cubeStore);
await identityStore.addIdentity(identity);

// Load an existing identity by public key
const publicKeyString = identity.publicKeyString;
const loadedIdentity = await identityStore.getIdentity(publicKeyString);
```

### Signed Content

```typescript
// Create content signed by an identity
const signedCube = await identity.createMUC({
  fields: [
    VerityField.Application('my-app'),
    VerityField.Username(identity.name),
    VerityField.Payload('This is signed content')
  ]
});

// Verify the signature
const isValid = await signedCube.verifySignature();
```

### Encrypted Content

```typescript
// Encrypt content for specific recipients
const recipients = [alice.publicKey, bob.publicKey];
const encryptedCube = await identity.createEncryptedCube(
  'Secret message',
  recipients
);

// Decrypt content (if you're a recipient)
const decryptedContent = await identity.decryptCube(encryptedCube);
```

## Building Applications

### Application Structure

Here's how to structure a basic Verity application:

```typescript
class MyApplication {
  private node: VerityNode;
  private identity: Identity;
  
  constructor(private appId: string) {}
  
  async initialize() {
    // Setup node and identity
    this.node = await VerityNode.Create();
    this.identity = await Identity.Create({
      cubeStore: this.node.cubeStore,
      name: 'User'
    });
  }
  
  async createContent(data: string) {
    const cube = cciCube.Frozen({
      fields: [
        VerityField.Application(this.appId),
        VerityField.Payload(data),
        VerityField.Username(this.identity.name)
      ]
    });
    
    await this.node.cubeStore.addCube(cube);
    return cube;
  }
  
  async getContent(): Promise<string[]> {
    const content: string[] = [];
    
    // Iterate through all cubes
    for await (const cubeInfo of this.node.cubeStore.getAllCubes()) {
      const cube = cubeInfo.getCube();
      
      // Check if this cube belongs to our application
      const appField = cube.getFirstField(FieldType.APPLICATION);
      if (appField?.value.toString() === this.appId) {
        const payloadField = cube.getFirstField(FieldType.PAYLOAD);
        if (payloadField) {
          content.push(payloadField.value.toString());
        }
      }
    }
    
    return content;
  }
  
  async shutdown() {
    await this.node.shutdown();
  }
}
```

### File Sharing Application

```typescript
import { FileApplication } from 'verity';

// Create cubes for a file
const fileContent = fs.readFileSync('document.pdf');
const fileCubes = await FileApplication.createFileCubes(
  fileContent,
  'document.pdf',
  (progress, remaining) => {
    console.log(`Upload progress: ${progress}%, ${remaining} bytes remaining`);
  }
);

// Store all cubes
for (const cube of fileCubes) {
  await node.cubeStore.addCube(cube);
}

// Retrieve and reconstruct file
const reconstructedFile = await FileApplication.retrieveFile(
  fileCubes[0], // Start with first cube
  node.cubeStore
);
```

### Chat Application

```typescript
import { ChatApplication } from 'verity';

// Create a chat room (notification key)
const chatRoomKey = Buffer.alloc(32, 'my-chat-room');

// Send a message
const chatCube = await ChatApplication.createChatCube(
  'Alice',
  'Hello everyone!',
  chatRoomKey
);
await node.cubeStore.addCube(chatCube);

// Listen for messages
node.cubeRetriever.requestNotifications(chatRoomKey).then(cubeInfo => {
  const { username, message } = ChatApplication.parseChatCube(
    cubeInfo.getCube()
  );
  console.log(`${username}: ${message}`);
});
```

## Examples

### Microblogging (like the included ZW app)

```typescript
import { makePost } from 'verity';

// Create a post
const post = await makePost('Hello Verity!', {
  id: identity,
  store: node.cubeStore
});

// Create a reply
const reply = await makePost('Great to see you here!', {
  id: identity,
  replyto: await post.getKey(),
  store: node.cubeStore
});

// Get posts from an identity
for await (const postInfo of identity.getPosts()) {
  const cube = postInfo.main;
  const payload = cube.getFirstField(FieldType.PAYLOAD);
  console.log('Post:', payload.value.toString());
}
```

### Custom Application Fields

```typescript
// Define custom application fields (0x30-0x3F range)
const CUSTOM_FIELD_TYPE = 0x30;

const cube = cciCube.Frozen({
  fields: [
    VerityField.Application('my-custom-app'),
    VerityField.Payload('Main content'),
    // Custom field
    {
      type: CUSTOM_FIELD_TYPE,
      value: Buffer.from('Custom data'),
      length: Buffer.from('Custom data').length
    }
  ]
});
```

## Best Practices

### Performance
- Use light nodes for client applications
- Only store cubes you actually need
- Consider cube lifetime when designing applications
- Use appropriate cube types (Frozen for temporary data, PICs for persistent data)

### Security
- Always encrypt sensitive data
- Verify signatures before trusting content
- Use proper key management practices
- Don't store private keys in plaintext

### Data Design
- Keep cubes under 1kB (they'll be rejected if larger)
- Use relationships to link related content
- Choose appropriate media types
- Include application identifiers

### Network Efficiency
- Reuse relationships when possible
- Avoid creating unnecessary cubes
- Use notification keys for real-time applications
- Consider pruning old data

## Troubleshooting

### Common Issues

**Cube too large:**
```typescript
// Check remaining space before adding fields
console.log('Bytes remaining:', cube.fields.bytesRemaining());
```

**Identity not found:**
```typescript
// Make sure to store the identity
await identityStore.addIdentity(identity);
await identity.store();
```

**Cube not found:**
```typescript
// Check if cube exists before retrieving
const exists = await node.cubeStore.hasCube(cubeKey);
if (!exists) {
  // Request from network if light node
  const cubeInfo = await node.cubeRetriever.requestCube(cubeKey);
}
```

**Network connectivity issues:**
- Check if running in a sandboxed environment
- Verify WebSocket transport is available
- For web applications, ensure HTTPS/WSS is used

### Debugging

Enable debug logging:
```typescript
import { logger } from 'verity';

// Set log level
logger.level = 'debug';

// Log cube information
const cube = await node.cubeStore.getCube(cubeKey);
console.log('Cube type:', cube.cubeType);
console.log('Cube size:', cube.binaryData.length);
console.log('Fields:', cube.fields.size);
```

### Testing

Use in-memory storage for tests:
```typescript
const testNode = await VerityNode.Create({
  inMemory: true,
  lightNode: true,
  announceToTorrentTrackers: false
});
```

## Next Steps

- Read the [API Reference](api-reference.md) for detailed method documentation
- Explore the [example applications](../examples/) 
- Study the [technical specifications](verity.md) for advanced features
- Join the Verity community for support and discussions

## Contributing

Verity is open to contributions! Please:
1. Read the technical documentation
2. Check existing issues and PRs
3. Follow the coding standards
4. Add tests for new features
5. Update documentation as needed