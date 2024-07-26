![](../img/vera_300px_nobg.png)

# Verity
Verity is a decentralised and censorship-resistant data storage and distribution
platform on top of which fully georedundant, peer-to-peer-enabled applications
can be built. It leverages unique cube structures, each containing 1kB of data,
which are then synchronized across participating nodes. Different Cube types
offer predefined cryptographic schemes to ensure data integrity and authenticity.
Although light nodes are supported, nodes are encouraged to be operated as full
nodes, replicating all cubes.

This project also creates a decentralized and censorship-resistant social
networking application using the Verity platform, which will be akin to Twitter,
Threads or Reddit. The platform supports 1:1 and 1:n encrypted messaging,
protecting user privacy by minimizing metadata leakage and allowing secure,
private communication between users. By offering a high degree of privacy,
security, and resistance to censorship, this project offers a compelling
alternative to traditional, centralized social networks.

> Note: this project does not implement a cryptocurrency, nor does it resemble a blockchain.

# Specifications
* [Cubes](cube.md) are the basic building blocks of Verity
* The [Common Cube Interface](cci.md) simplifies and streamlines how applications
  store and retrieve data to and from Cubes

# Cube Store
  The cube store is part of each node and contains all the cubes known. While a full node is online it tries to keep its Node Store synchronized with the rest of the network by regularly synchronizing with all connected peers.

## Spam Prevention
  Verity has two primary defenses against Denial of Service (DoS):
### Hashcash
  The node's cube store sets a challenge level of trailing zeroes for each cube, any cubes that fail this challenge get rejected and dropped. The level initially will be hardcoded, but later may be adjusted to scale with the amount of data in the Cube Store. This is a well proven defense against spam and sufficiently effective.
### Ephemeral Cubes
  Cubes have a limited lifetime. By default they will only live for 7 days until dropped from the network. Though once switching to Merkle Patricia Trie (MPT) timestamps can be easily sorted into different subtrees, allowing flexible control over cube retention times. Nodes may regularly re-inject their posts to keep them available online, if desired.

  > Also see chapter Cube Lifetime Function

# Network Communication
  1. **Protocol Version (1 byte)**: This is the version of the protocol being used. This allows for future updates and backward compatibility. For now, you can set this to 0x01.

  2. **Message Class (1 byte)**: This is an identifier for the type of message. Here's a possible mapping:
  - `0x00`: `Hello`
  - `0x01`: `KeyRequest`
  - `0x02`: `KeyResponse`
  - `0x03`: `CubeRequest`
  - `0x04`: `CubeResponse`
  - `0x05`: `MyServerAddress`
  - `0x06`: `NodeRequest`
  - `0x07`: `NodeResponse`

  Each of these message classes will have different data payloads:
  - `Hello`: **Node Identifier (16 bytes)**: This is a unique NodeID that's randomly generated at startup. Primary purpose is to detect when we connected to ourselves. This may happen if we don't know our external IP. (e.g. NAT) Secondarily this may be used to detect duplicate connections to the same node, which may happen if the node is reachable via multiple IPs.

  - `KeyRequest`:
    - **Header Byte (1 byte)**: Indicates the mode of the request:
      * `0x00`: Legacy Mode (Deprecated)
      * `0x01`: Sliding Window Mode
      * `0x02`: Sequential Store Sync Mode
      * (KeyRequest missing a header byte is treated as Legacy Mode request)
    - **Key Count (4 bytes)**: This is an integer indicating the number of keys being requested.
    - **Request Key (32 bytes)**: Used in Sliding Window and Sequential Store Sync modes. Specifies the key to start from. In Sliding Window Mode it can be zero to start from the beginning. Mandatory in Sequential Store Sync Mode. The key itself is not included in the response, only the respective keys that succeed it.

    To support Sliding Window Mode each node holds one sliding window of the keys to the most recently received cubes. Upon receiving a request the requested key is identified and the keys succeeding it, up to the number of requested keys, is then sent via KeyResponse. The size of the window is configurable, but should be at least 1000 keys. The oldest keys are overwritten by the newest. This mode is meant for near real-time synchronization of the most recent cubes. On startup if no new cubes are downloaded the keys reported from other nodes may be used to fill the window, even if the respective cubes are already in the store.

    Sequential Store Sync Mode is a similar approach to Sliding Window Mode, but instead of a window, the node sends keys that succeed the requested key in the store. Reaching the last key of the store is a special case, where the node loops back to the first key and continues. This mode is mainly meant for background synchronization of the store.

    This message may get extended in the future to allow for more fine-grained control over which keys to request. (e.g. by date or by MPT subtree)

    >DoS Vulnerability: The Legacy Mode is deprecated and not recommended due to its potential for Denial of Service attacks. Supporting it requires large amounts of RAM on the node to store all keys.

  - `KeyResponse`:
    - **Key Count (4 bytes)**: This is an integer indicating the number of keys being sent.
    - **Cube Details**: Each detail includes:
      - **Cube Type (1 byte)**: The type of the cube (e.g., regular, MUC, IPC).
      - **Challenge Level (1 byte)**: The challenge level the cube adheres to.
      - **Timestamp (5 bytes)**: The timestamp of the cube.
      - **Key (32 bytes)**: The key of the cube.

  - `CubeRequest`:
    - **Cube Key Count (4 bytes)**: This is an integer indicating the number of cubes being requested.
    - **Cube Keys (32 bytes each)**: This is a series of 32-byte Cube key values. The number of keys must match the previously indicated Cube Key Count.

  - `CubeResponse`:
    - **Cube Count (4 bytes)**: This is an integer indicating the number of cubes being sent.
    - **Cubes (1024 bytes each)**: This is a series of cubes. Each cube is 1024 bytes as per your cube specification. The number of cubes should match the Cube Count.

  - `MyServerAddress`:
    - **Node Address type  (1 byte)**: 1=WebRTC, 2=LibP2p
    - **Node Address length (2 bytes)**
    - **Node Address string (variable length)**

  - `NodeRequest`: This message requests a list of known node addresses from a peer.
    - **Payload**: None

  - `NodeResponse`: This message provides a list of known node addresses to a peer.
    - **Node Count (4 bytes)**: An integer indicating the number of node addresses being sent.
    - **Node Entries (variable length)**: A series of node entries. Each entry consists of:
      - **Node Address type  (1 byte)**: 1=WebRTC, 2=LibP2p
      - **Node Address Length (2 bytes)**: An integer indicating the length of the node address.
      - **Node Address string (variable length)**: The node address (e.g., WebSocket URL). The length of the address should match the Node Address Length.

# Encryption

## Cryptographic primitives used
   - All hashes are SHA3, may be truncated where sensible.
   - All signatures are ED25519
   - Fingerprints of either are truncated to 64 bit

  > Note: Signatures are very computationally expensive. Signing a cube with ED25519 is roughly 20 times as expensive as hashing with SHA3, verifying the signature even 60 times. Thus whenever signatures are to be verified, the cube challenge has to be verified first, in order to avoid creating a vector for Denial of Service (DoS).

## Goals
   - Everything should be encrypted by default.
   - Encryption is handled in CCI
   - Options are:
     - Convergent encryption system with the plaintext hash as key and IV set to zero. (Key is never re-used so IV is not needed.)
       - This allows for de-duplication of IPC cubes.
       - This needs to be aware of continuation chains in order to avoid key re-use.
     - Encryption with a custom key (randomly generated or pre-shared)
   - We probably need an IV. But we can't use the nonce, since it changes after encryption to solve the challenge.

## Crypto Fields
**Key Distribution Field (`TYPE_KEY_DISTRIBUTION`):**

This type is used for fields that distribute a symmetric key for decryption of subsequent fields in the cube.

1. The sender creates an ephemeral Curve25519 key pair.
2. The sender uses the ephemeral private key and the recipient's public key (obtained from their address) to derive a shared symmetric key using `crypto_scalarmult_curve25519`.
3. The sender uses the shared symmetric key to encrypt the subsequent fields in the cube.
4. The field value for the `TYPE_KEY_DISTRIBUTION` field is composed of the following parts:
   - The 32-byte ephemeral public key, which the recipient will need to derive the same shared symmetric key.
   - A truncated 8-byte (64-bit) hash of the recipient's public key, so the recipient can identify that they are the intended recipient.

**Shared Key Field (`TYPE_SHARED_KEY`):**

This type is used for fields that deliver a symmetric key to the recipient. These fields can be placed within `TYPE_ENCRYPTED` sections and can be included multiple times to deliver multiple keys.

The field value for the `TYPE_SHARED_KEY` field is a 32-byte symmetric key, which the recipient should add to their key store for decrypting future messages.

**Encrypted Cube (`TYPE_ENCRYPTED`):**

This type is used for fields that contain encrypted data. The encryption is done using a symmetric key, which could be distributed in the same cube or derived from a key in the recipient's key store.

1. The field starts with an 8-byte (64-bit) hash/fingerprint of the symmetric key used for encryption. The recipient uses this hash to identify the correct key for decryption.
2. The rest of the field contains the encrypted data.

**1:1 Messages:**

For 1:1 messages, the sender creates a single cube with the recipient's public key and the message payload in the `TYPE_ENCRYPTED` section. This section is encrypted with a symmetric key derived using `crypto_scalarmult_curve25519` and the ephemeral key pair. The cube also contains a `TYPE_KEY_DISTRIBUTION` field with the ephemeral public key and the hash of the recipient's public key.

**1:n Messages:**

For 1:n messages, the sender creates multiple cubes, one for each recipient. Each cube contains a `TYPE_KEY_DISTRIBUTION` field with an ephemeral public key (different for each cube) and the hash of the recipient's public key. The `TYPE_ENCRYPTED` section of each cube can contain the same or different payloads for each recipient.

Additionally, the sender can include one or more `TYPE_SHARED_KEY` fields within the `TYPE_ENCRYPTED` section of each cube. These fields contain symmetric keys that the recipients should add to their key store for decrypting future messages. This allows the sender to establish multiple shared keys with each recipient in a single cube.

This comprehensive system allows for secure, efficient, and flexible communication, supporting both 1:1 and 1:n messages while minimizing metadata leakage and cube size. It also provides a robust mechanism for nodes to quickly identify and retrieve relevant data.

## Design
### Logo
![](../img/vera_150px_nobg.png)

The dove Vera (short for Veracity) is the logo of Verity. The dove not only signifies peace, harmony, and purity, but also symbolizes the free spirit of a decentralized network that cannot be caged or controlled, much like the dove itself.
### Names
#### Verity
Verity was chosen as the name of the project. It aligns with the project goals and is conscise, yet not too common. Verity is another word for "truth". It's shorter and simpler than Veracity, but similar in meaning.

#### Veracity
This word means "truthfulness" or "accuracy", which could refer to the authenticity and integrity of the cubes in the network. It's an uncommon word, which could make the project stand out, but it may also be less immediately understandable to some users.

## Outlook
### Network
- `Light Nodes`: Besides full nodes with full replication one can also operate light nodes that only request cubes on demand. They should prefer to connect to full nodes and communicate their status as network leaves.
- `Bloom filters`: To further improve efficiency light nodes receive bloom filters of connected nodes in order to determine which peers to request cubes from.
- `DHT Nodes`: Another extension could be DHT nodes. Instead of aiming for full replication, these nodes just replicate a portion of the cube-space within their DHT address range. They have a bit less utility to the network, but also can operate with less resources.
- `Merkle Patricia Trie`: To improve efficiency during synchronization we can store all hashes in an MPT. This would allow efficient comparison and synchronization with a complexity of O(log(n)). Likely advisable to scale beyond a million cubes per day.

When two nodes synchronize, they compare the root hash of their MPTs. If the hashes are different, this indicates that the nodes have a different set of cubes. The nodes can then recursively compare the hashes of their children, continuing down the tree, until they identify the cubes that differ. This allows the nodes to find the specific cubes that need to be updated, without having to compare every single cube hash.

### Client
- `Reference Client`: The reference client is to be written in TypeScript and supports a WebSocket transport. This will allow porting the client to the web for easier access. PWA could be an option, especially for light nodes.
> TODO: PWAs prohibit self-signed certificates. By switching to WebRTC we can avoid this issue and also gain NAT traversal.
### Features
- `Accounts`: Identities will be implemented through asymmetric cryptography. Users can create one or more public/private key pairs and use them to receive direct messages addressed to the hash of their public key, as well as to sign their messaged.

