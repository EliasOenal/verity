# Verity API Reference

Reference documentation for Verity's high-level APIs.

## VerityNode

Main entry point for interacting with the Verity network.

```typescript
class VerityNode extends CoreNode {
  static async Create(options?: VerityNodeOptions): Promise<VerityNode>
  
  readonly cubeStore: CubeStore
  readonly cubeRetriever: CubeRetriever  
  readonly veritumRetriever: VeritumRetriever
  readonly networkManager: NetworkManager
  
  async shutdown(): Promise<void>
}

interface VerityNodeOptions extends CoreNodeOptions {
  inMemory?: boolean        // Use in-memory storage (testing only)
  lightNode?: boolean       // Only store needed cubes
  listenPort?: number       // Port to listen on
}
```

## Common Cube Interface (CCI)

### cciCube

```typescript
class cciCube extends Cube {
  static Frozen(options: CciCubeCreateOptions): cciCube
  static MUC(publicKey: Buffer, privateKey: Buffer, options?: CciCubeCreateOptions): cciCube
  
  readonly fields: VerityFields
  
  getFirstField(fieldType: FieldType): Field | undefined
  getAllFields(fieldType: FieldType): Field[]
}

interface CciCubeCreateOptions {
  fields: VerityField[]
}
```

### VerityField

Factory for creating standardized fields.

```typescript
class VerityField {
  static Application(identifier: string): Field
  static Payload(data: string | Buffer): Field
  static ContentName(name: string): Field
  static Username(name: string): Field
  static PublicKey(key: Buffer): Field
  static Signature(sig: Buffer): Field
  static Timestamp(date: Date): Field
}
```

## Veritum

Handles data larger than 1kB by automatic splitting and reconstruction.

```typescript
class Veritum {
  static Create(options: VeritumCreateOptions): Veritum
  static FromChunks(chunks: Iterable<cciCube>): Veritum
  
  async compile(): Promise<cciCube[]>
  getFirstField(fieldType: FieldType): Field | undefined
}

interface VeritumCreateOptions {
  fields: VerityField[]
}
```

## Identity

Manages cryptographic identities.

```typescript
class Identity {
  static async Create(options?: IdentityCreateOptions): Promise<Identity>
  static async Load(publicKeyString: string): Promise<Identity>
  
  readonly name: string
  readonly publicKeyString: string
  
  async createMUC(options: CciCubeCreateOptions): Promise<cciCube>
  async sign(data: Buffer): Promise<Buffer>
}

interface IdentityCreateOptions {
  name?: string
  inMemory?: boolean
}
```

## Constants

```typescript
enum FieldType {
  APPLICATION = 0x01,
  PAYLOAD = 0x02,
  CONTENT_NAME = 0x03,
  USERNAME = 0x04,
  PUBLIC_KEY = 0x05,
  SIGNATURE = 0x06,
  TIMESTAMP = 0x07
}
```