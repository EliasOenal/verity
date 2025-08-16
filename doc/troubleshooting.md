# Verity Troubleshooting and Best Practices

This document provides guidance for common issues and best practices when developing with Verity.

## Table of Contents

1. [Common Issues](#common-issues)
2. [Best Practices](#best-practices)
3. [Performance Guidelines](#performance-guidelines)
4. [Security Considerations](#security-considerations)
5. [Debugging Tips](#debugging-tips)
6. [FAQ](#faq)

## Common Issues

### Build and Setup Issues

#### Module Resolution Errors

**Problem**: `ERR_MODULE_NOT_FOUND` or similar import errors

**Solutions**:
```bash
# Ensure the project is built
npm run build

# Check that dependencies are installed
npm install

# For TypeScript projects, ensure proper tsconfig.json
```

**Example tsconfig.json for Verity applications**:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "node",
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true
  }
}
```

#### Webpack Build Issues

**Problem**: Compilation errors when building web applications

**Solutions**:
```bash
# Use the development server instead
npm run server

# Check for TypeScript errors
npm run build

# For production builds, some modules may need polyfills
```

### Runtime Issues

#### Cube Size Limit Exceeded

**Problem**: `FieldSizeError` or cubes rejected for being too large

**Solutions**:
```typescript
// Check remaining space before adding fields
console.log('Bytes remaining:', cube.fields.bytesRemaining());

// Split large content across multiple cubes
if (content.length > cube.fields.bytesRemaining()) {
  // Use FileApplication for large files
  const fileCubes = await FileApplication.createFileCubes(content, 'filename');
}

// Use continuation relationships for multi-cube content
cube.insertFieldBeforeBackPositionals(
  VerityField.RelatesTo(new Relationship(RelationshipType.CONTINUED_IN, nextCubeKey))
);
```

#### Identity Not Found

**Problem**: `Identity not found` or authentication failures

**Solutions**:
```typescript
// Ensure identity is stored
await identity.store();
await identityStore.addIdentity(identity);

// Check if identity exists before using
const existingIdentity = await identityStore.getIdentity(publicKeyString);
if (!existingIdentity) {
  // Create or load identity
}

// Verify identity has required permissions
const hasAccess = identity.hasPublicSubscription(targetPublicKey);
```

#### Network Connectivity Issues

**Problem**: Connection timeouts or peer discovery failures

**Solutions**:
```typescript
// For development, disable external connections
const node = await VerityNode.Create({
  announceToTorrentTrackers: false,
  lightNode: true,
  inMemory: true
});

// Check network status
console.log('Online peers:', node.networkManager.onlinePeers.length);

// For production, ensure proper ports and firewall settings
// WebSocket transport requires ports to be open
```

#### Cube Retrieval Failures

**Problem**: Cubes not found or retrieval timeouts

**Solutions**:
```typescript
// Check if cube exists locally first
const exists = await node.cubeStore.hasCube(cubeKey);
if (!exists) {
  // Request from network for light nodes
  try {
    const cubeInfo = await node.cubeRetriever.requestCube(cubeKey);
  } catch (error) {
    console.log('Cube not available on network');
  }
}

// For full nodes, cube should be automatically available
// Check if node is properly connected to peers
```

### Web Application Issues

#### Service Worker Registration

**Problem**: Service worker fails to register or update

**Solutions**:
```javascript
// Check service worker support
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
    .then(registration => console.log('SW registered'))
    .catch(error => console.log('SW registration failed', error));
}

// Clear service worker cache during development
// Use browser dev tools > Application > Service Workers > Unregister
```

#### HTTPS/WSS Requirements

**Problem**: WebSocket connections fail in production

**Solutions**:
- Use HTTPS for production deployments
- Ensure WebSocket server supports WSS (secure WebSockets)
- For development, use localhost which allows insecure connections

## Best Practices

### Application Architecture

#### Use Appropriate Node Types

```typescript
// For client applications (mobile, web)
const clientNode = await VerityNode.Create({
  lightNode: true,
  inMemory: true,
  announceToTorrentTrackers: false
});

// For server applications or infrastructure
const serverNode = await VerityNode.Create({
  lightNode: false,  // Full node
  persistenceDirectory: './verity-data',
  announceToTorrentTrackers: true
});
```

#### Proper Resource Management

```typescript
class MyApplication {
  private node: VerityNode;
  
  async initialize() {
    this.node = await VerityNode.Create(/* options */);
  }
  
  async shutdown() {
    // Always cleanup resources
    await this.node.shutdown();
  }
}

// Use try/finally for cleanup
try {
  await app.initialize();
  // Application logic
} finally {
  await app.shutdown();
}
```

### Data Design

#### Choose Appropriate Cube Types

```typescript
// For temporary content (expires in 7 days)
const tempCube = cciCube.Frozen({ fields: [...] });

// For user-updatable content
const userCube = await identity.createMUC({ fields: [...] });

// For persistent content (can be extended by anyone)
// Note: PIC implementation is not yet complete
```

#### Use Standard CCI Fields

```typescript
// Always include application identifier
VerityField.Application('my-app'),

// Use appropriate media types
VerityField.MediaType(MediaTypes.TEXT),

// Include timestamps for time-sensitive content
VerityField.Date(1, Math.floor(Date.now() / 1000)),

// Use relationships to link content
VerityField.RelatesTo(new Relationship(RelationshipType.REPLY_TO, parentKey))
```

#### Efficient Field Usage

```typescript
// Check space before adding fields
if (cube.fields.bytesRemaining() < estimatedFieldSize) {
  // Create a new cube or use continuation
}

// Use appropriate field types
VerityField.Username(name),      // For user names
VerityField.ContentName(title),  // For titles/subjects
VerityField.Description(desc),   // For descriptions
VerityField.Payload(content)     // For main content
```

### Security

#### Identity Management

```typescript
// Generate strong identities
const identity = await Identity.Create({
  name: 'User',
  // Store securely
  cubeStore: secureNode.cubeStore
});

// Verify signatures before trusting content
const isValid = await signedCube.verifySignature();
if (!isValid) {
  throw new Error('Invalid signature');
}

// Use encryption for sensitive data
const recipients = [alice.publicKey, bob.publicKey];
const encryptedCube = await identity.createEncryptedCube(
  'Sensitive information',
  recipients
);
```

#### Input Validation

```typescript
// Validate cube content before processing
if (!assertZwCube(cube)) {
  console.log('Invalid cube format');
  return;
}

// Sanitize user input
import DOMPurify from 'dompurify';
const cleanContent = DOMPurify.sanitize(userInput);

// Check field limits
if (content.length > MAX_CONTENT_LENGTH) {
  throw new Error('Content too large');
}
```

### Performance

#### Efficient Storage

```typescript
// Use in-memory storage for temporary applications
const testNode = await VerityNode.Create({ inMemory: true });

// Use persistent storage for long-running applications
const prodNode = await VerityNode.Create({
  persistenceDirectory: './data',
  inMemory: false
});

// Implement pruning for large datasets
// (Note: Automatic pruning not yet implemented)
```

#### Network Optimization

```typescript
// Batch cube operations when possible
const cubes = [cube1, cube2, cube3];
for (const cube of cubes) {
  await node.cubeStore.addCube(cube);
}

// Use notification keys for real-time updates
const notificationKey = Buffer.alloc(32, 'chat-room-id');
node.cubeRetriever.requestNotifications(notificationKey);

// Minimize relationship chains
// Deep relationship traversal can be expensive
```

## Performance Guidelines

### Memory Management

- Use in-memory storage only for development/testing
- Monitor cube store size in long-running applications
- Consider implementing application-level caching
- Clean up unused identities and subscriptions

### Network Efficiency

- Minimize cube creation frequency
- Use appropriate relationships instead of duplicating data
- Consider cube lifetime when designing data structures
- Use light nodes for client applications

### Storage Optimization

- Use persistent storage for production applications
- Consider storage space when designing cube layouts
- Plan for cube expiration (7-day default lifetime)
- Use compression for large payloads when appropriate

## Security Considerations

### Cryptographic Best Practices

- Never store private keys in plaintext
- Verify signatures on all received content
- Use proper key derivation for related identities
- Implement proper key rotation policies

### Content Validation

- Always validate cube structure before processing
- Sanitize all user-generated content
- Implement rate limiting for cube creation
- Validate relationship targets exist

### Privacy Protection

- Use encryption for sensitive communications
- Minimize metadata exposure
- Consider using anonymous identities when appropriate
- Implement proper access controls

## Debugging Tips

### Enable Debug Logging

```typescript
import { logger } from 'verity';

// Set log level for debugging
logger.level = 'debug';

// Log specific operations
console.log('Cube key:', await cube.getKeyString());
console.log('Node status:', node.ready);
console.log('Peer count:', node.networkManager.onlinePeers.length);
```

### Inspect Cube Contents

```typescript
// Examine cube structure
console.log('Cube type:', cube.cubeType);
console.log('Cube size:', cube.size);
console.log('Field count:', cube.fields.size);
console.log('Bytes remaining:', cube.fields.bytesRemaining());

// Examine specific fields
const payload = cube.getFirstField(FieldType.PAYLOAD);
console.log('Payload:', payload?.value.toString());

// Check cube validity
console.log('Cube valid:', cube.isValid);
```

### Network Debugging

```typescript
// Check node connectivity
console.log('Network ready:', node.networkManager.ready);
console.log('Transport status:', node.networkManager.transports);

// Monitor cube events
node.cubeStore.on('cubeAdded', (cube) => {
  console.log('Cube added:', cube.getKeyIfAvailable()?.toString('hex'));
});
```

## FAQ

**Q: How do I handle large files?**
A: Use the FileApplication class which automatically splits files across multiple cubes and handles reassembly.

**Q: Can I delete cubes once created?**
A: Frozen cubes expire after 7 days automatically. For immediate removal, you need to implement application-level logic to ignore specific cubes.

**Q: How do I ensure my application data is compatible with others?**
A: Use standard CCI fields and include your application identifier. Follow the CCI specifications for field types.

**Q: What happens if a cube is larger than 1kB?**
A: The cube will be rejected. Use continuation relationships or the FileApplication utility for large content.

**Q: How do I handle offline scenarios?**
A: Light nodes can work offline with locally stored cubes. Consider implementing local caching and sync strategies.

**Q: Can I run multiple nodes in the same application?**
A: Yes, but be careful with port conflicts and resource usage. Each node manages its own storage and network connections.

**Q: How do I migrate data between node versions?**
A: Cube format is designed to be forward-compatible. Store critical application data using standard CCI fields for best compatibility.

**Q: What's the difference between a VerityNode and CoreNode?**
A: VerityNode extends CoreNode with additional CCI functionality. Use VerityNode for applications that need CCI features.

**Q: How do I implement user authentication?**
A: Use Identity objects with public/private key pairs. Verify signatures on user-generated content to ensure authenticity.

**Q: Can I use Verity in a web browser?**
A: Yes, the included web application demonstrates browser usage. Some features may require service workers or web workers for full functionality.