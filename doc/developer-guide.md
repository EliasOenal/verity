# Verity Developer Guide

Verity is a decentralized data storage and distribution platform that uses "cube" structures for peer-to-peer applications. This guide covers the high-level APIs developers should use.

## Core Concepts

### Cubes
Cubes are 1kB data containers with content-derived keys. For application development, use the Common Cube Interface (CCI) rather than manipulating cubes directly.

### Common Cube Interface (CCI)
CCI provides standardized Type-Length-Value (TLV) structured data within cubes, enabling interoperability between applications.

### Veritum
Automatically handles data larger than 1kB by splitting across multiple cubes and providing seamless reconstruction.

### Identities
Cryptographic keypairs for signing, authenticating, and encrypting content.

## Getting Started

```bash
git clone https://github.com/EliasOenal/verity.git
cd verity
npm install
npm run build
```

### Basic Node Setup

```typescript
import { VerityNode } from './src/index.js';

// Create a node with persistent storage
const node = await VerityNode.Create({
  lightNode: true  // Only store cubes you need
});
```

## Using CCI for Structured Data

```typescript
import { cciCube, VerityField } from './src/index.js';

// Create structured data
const messageCube = cciCube.Frozen({
  fields: [
    VerityField.Application('my-app'),
    VerityField.Username('Alice'),
    VerityField.Payload('Hello, Verity!')
  ]
});

await node.cubeStore.addCube(messageCube);
```

### Field Types
- `VerityField.Application(string)` - Application identifier
- `VerityField.Username(string)` - User name  
- `VerityField.Payload(string|Buffer)` - Main content
- `VerityField.ContentName(string)` - File or content name
- `VerityField.Timestamp(Date)` - Timestamp
- `VerityField.PublicKey(Buffer)` - Public key
- `VerityField.Signature(Buffer)` - Digital signature

## Working with Veritum

```typescript
import { Veritum } from './src/index.js';

// Handle large data automatically
const largeContent = Buffer.from('Large document content...');

const veritum = Veritum.Create({
  fields: [
    VerityField.Application('document-app'),
    VerityField.ContentName('document.txt'),
    VerityField.Payload(largeContent)
  ]
});

// Automatically split into multiple cubes
const cubes = await veritum.compile();
for (const cube of cubes) {
  await node.cubeStore.addCube(cube);
}
```

## Identity Management

```typescript
import { Identity } from './src/index.js';

// Create identity with persistent storage
const identity = await Identity.Create({
  name: 'Alice'
});

// Create signed content
const signedCube = await identity.createMUC({
  fields: [
    VerityField.Application('my-app'),
    VerityField.Payload('Signed content')
  ]
});

// Verify signatures
const isValid = await signedCube.verifySignature();
```

## Best Practices

- Use **light nodes** for applications that don't need to store all network data
- Use **persistent storage** (default) rather than in-memory for production applications  
- **Verify signatures** on received content
- Use **appropriate field types** to ensure interoperability
- Use **Veritum** for data larger than what fits in a single cube