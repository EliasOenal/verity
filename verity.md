![](img/vera_250px_nobg.png)

# Project Verity
This project aims to create a decentralized and censorship-resistant social networking platform akin to Twitter, Threads or Reddit. It leverages unique block structures, (not related to blockchains or cryptocurrency) each containing 1kB of data, which are then synchronized across participating nodes. To ensure data integrity and authenticity, posts are signed with user-specific cryptographic keys and utilize a hashcash challenge to mitigate spam. The platform supports 1:1 and 1:n encrypted messaging, protecting user privacy by minimizing metadata leakage and allowing secure, private communication between users. By offering a high degree of privacy, security, and resistance to censorship, this project offers a compelling alternative to traditional, centralized social networks.

Although light nodes are supported, nodes are encouraged to be operated as full nodes, replicating all blocks.

# Block Specification
Blocks are the elemental units of Verity. Every feature of the network is constructed on top of blocks.
1. **Total Size**: Each block has a total size of 1024 bytes.

2. **Protocol Version and Reserved Bits (1 byte)**: The first nibble (4 bits) of the first byte of the block is the protocol version. Currently, the only defined protocol version is 0. The second nibble of the first byte is reserved for future use.

3. **Date (5 bytes)**: The next 5 bytes represent the date when the block was created, encoded as a truncated UNIX timestamp. This timestamp represents the number of seconds since the UNIX epoch (1970-01-01), truncated to 5 bytes. This is used to prune old blocks from the network.

4. **Type-Length-Value (TLV) Fields (variable length)**: The rest of the block consists of a series of TLV fields. Each field starts with a one-byte type identifier, followed by a length (types of static length may omit this) and the actual value. The type is a 6-bit identifier, and the length, if present, is encoded as a 10-bit integer, both packed into a two-byte header. The length is encoded as big endian.

  - **Type (6 bits)**: This is an identifier for the type of data. The defined types are as follows:

    - 0b000000: `TYPE_PAYLOAD`
    - 0b000001: `TYPE_RELATES_TO`
    - 0b000010: `TYPE_PADDING_NONCE`
    - 0b000011: `TYPE_KEY_DISTRIBUTION`
    - 0b000100: `TYPE_SHARED_KEY`
    - 0b000101: `TYPE_ENCRYPTED`
    - 0b000110: `TYPE_SIGNATURE`
    - 0b000111: `TYPE_SPECIAL_BLOCK`
    
    (Detailed description below)

  - **Length (10 bits, optional)**: This is the length of the value in bytes. For types with a fixed length, such as the "relates-to" hash (32 bytes), the digital signature (64 bytes), and the Shared Key (32 bytes), this field is omitted and the length is implicitly known. For types with variable length, this field specifies the length of the value.
   
  - **Value (variable length)**: This is the actual data. The length of this field is specified by the length field or is implicitly known based on the type.

5. **Type Fields**
  - **TYPE_PAYLOAD**: This is the main data payload of the block, and its length can vary from 0 to the remaining size of the block after accounting for other fields. The length utilizes the 10 bit length value of the TLV header. The payload can contain any data, but it is intended to hold the main content of the post or message.

  - **TYPE_KEY_DISTRIBUTION**: This field is used to distribute symmetric keys for encrypted communications. It has a fixed size of 40 bytes and does not require a length field. The first 8 bytes represent the hash (fingerprint) of the recipient's public key. The following 32 bytes represent the ephemeral public key used to derive the symmetric key. The recipient can use their private key and the ephemeral public key to derive the same symmetric key for decrypting the associated `TYPE_ENCRYPTED` field.

  - **TYPE_SHARED_KEY**: This field is used to store a symmetric key that has been encrypted with a previously distributed symmetric key. It has a fixed size of 32 bytes and does not require a length field. This symmetric key is used for decrypting other `TYPE_ENCRYPTED` fields and may be stored for future use.

  - **TYPE_ENCRYPTED**: This field holds encrypted data. It can contain any number of embedded TLV fields, which are to be parsed after decryption. The encryption key used is either the one associated with a preceding `TYPE_KEY_DISTRIBUTION` field in the same block or a key previously distributed and stored in the recipient's key store. The first 8 bytes of the field contain the hash of the symmetric key (fingerprint) used for encryption, allowing the recipient to find the correct key for decryption. The rest of the field contains the encrypted data of further fields embedded within. (e.g. `TYPE_PAYLOAD` and `TYPE_SIGNATURE`)

  - **Relates-To (optional, 32 bytes)**: If present, this field indicates that the block is a continuation of another post. The field contains the hash of the post it relates to. The type code for this field is `TYPE_RELATES_TO`
    > **TODO**: Implement different types of continuations, like replies, quotes, etc. This will require at least one more byte.

  - **Padding/Nonce (optional, variable length)**: If the block includes a proof-of-work, a padding field is inserted to provide scratch space for the nonce. It is also used for signature fields, to fill the space between the prior field and the signature. The padding field has a type of `TYPE_PADDING`, and its length is calculated based on the size of the other fields and the signature. The last N bytes of the padding field serve as the nonce for the proof-of-work. The value of the nonce is initially set to zero, and is incremented with each attempt to generate a valid hash.

  - **Signature (optional, 64 bytes)**: If present, the ED25519 signature is placed at the end of the block. The signature has a type of `TYPE_SIGNATURE` and does not have an associated length field because its size is fixed. The signature is calculated over all the bytes of the block from the start up to and including the type byte of the signature field.

  - **TYPE_SPECIAL_BLOCK**: If used, this field has to be first in the block following the header. This type activates special block formats, such as MUB or IPB. It is only one byte long, leaving just two bits after the 6 bit type encoding:
   - 0b00: `BLOCK_TYPE_MUB`
   - 0b01: `BLOCK_TYPE_IPB`
   - 0b10: `BLOCK_TYPE_RESERVED`
   - 0b11: `BLOCK_TYPE_RESERVED2` (Could be used to enable another byte of payload)

# Block Store
  The block store is part of each node and contains all the blocks known. While a full node is online it tries to keep its Node Store synchronized with the rest of the network by regularly synchronizing with all connected peers.

## Spam Prevention
  Verity has two primary defenses against Denial of Service (DoS):
### Hashcash
  The network sets a challenge level of trailing zeroes for each block, any blocks that fail this challenge get rejected and dropped. The level initially will be hardcoded, but later may be adjusted to scale with the amount of data in the Block Store. This is a well proven defense against spam and sufficiently effective.
### Ephemeral Blocks
  Blocks have a limited lifetime. By default they will only live for 7 days until dropped from the network. Though once switching to Merkle Patricia Trie (MPT) timestamps can be easily sorted into different subtrees, allowing flexible control over block retention times. Nodes may regularly re-inject their posts to keep them available online, if desired.

  > Upcoming Extension: See chapter Block Lifetime Function

# Network Communication
  1. **Protocol Version (1 byte)**: This is the version of the protocol being used. This allows for future updates and backward compatibility. For now, you can set this to 0x01.

  2. **Message Class (1 byte)**: This is an identifier for the type of message. Here's a possible mapping:
  - `0x00`: `Hello`
  - `0x01`: `HashRequest`
  - `0x02`: `HashResponse`
  - `0x03`: `BlockRequest`
  - `0x04`: `BlockResponse`
  - `0x05`: `NodeRequest`
  - `0x06`: `NodeResponse`
  - `0x07`: `NodeBroadcast`

  Each of these message classes will have different data payloads:
  - `Hello`: **Node Identifier (16 bytes)**: This is a unique NodeID that's generated at startup. Primary purpose is to detect when we connected to ourselves. This may happen if we don't know our external IP. (e.g. NAT)

  - `HashRequest`: This message also might not need any further data. The act of sending it could suffice to request all block hashes.

  - `HashResponse`:
    - **Hash Count (4 bytes)**: This is an integer indicating the number of hashes being sent.
    - **Hashes (32 bytes each)**: This is a series of 32-byte hash values. The number of hashes should match the Hash Count.<br><br>

  - `BlockRequest`:
    - **Block Hash Count (4 bytes)**: This is an integer indicating the number of block hashes being requested.
    - **Block Hashes (32 bytes each)**: This is a series of 32-byte hash values. The number of hashes should match the Block Hash Count.<br><br>

  - `BlockResponse` and `BlockSend`:
    - **Block Count (4 bytes)**: This is an integer indicating the number of blocks being sent.
    - **Blocks (1024 bytes each)**: This is a series of blocks. Each block is 1024 bytes as per your block specification. The number of blocks should match the Block Count.<br><br>

  - `NodeRequest`: This message requests a list of known node addresses from a peer.
    - **Payload**: None<br><br>

  - `NodeResponse`: This message provides a list of known node addresses to a peer.

    - Payload:
        - **Node Count (4 bytes)**: An integer indicating the number of node addresses being sent.
        - **Node Entries (variable length)**: A series of node entries. Each entry consists of:
          - **Node Address Length (2 bytes)**: An integer indicating the length of the node address.
          - **Node Address (variable length)**: The node address (e.g., WebSocket URL). The length of the address should match the Node Address Length.
<br><br>
  - `NodeBroadcast`: This message voluntarily sends a list of known node addresses to a peer, without a prior NodeRequest.

    - **Payload:** Same as NodeResponse.

## Planned Extension: Block Key Modification for Efficient Network Communication

To further enhance the efficiency and functionality of network communication, a modification to the structure of block keys is planned. The first five bytes of the block key, which currently represent a portion of the block hash, will be replaced with the five bytes of the block header that store the block's date.

 > Has synergies with extension: Block Lifetime Function

### Key Structure

This new key structure will still have more than enough bits to work reliably as a hash, while also including critical information about the block's age directly in the key. 

With this update, the key for a block will be generated as follows:

- The first five bytes will represent the date of the block.
- The remaining bytes will represent a truncated hash of the block.

### Benefits 

This modification will allow nodes to easily determine the age and the hashcash challenge level of a block just from its key, without needing to download the entire block. 

This has several benefits:

- **Efficient Block Evaluation**: Nodes can efficiently determine whether the blocks on offer meet their local requirements in terms of the hashcash challenge and block lifetime. This allows nodes to make more informed decisions about which blocks to request and save bandwidth by avoiding downloading blocks that do not meet their requirements.
  
- **Block Lifetime Enforcement**: The age of a block can be easily calculated from its key, enabling nodes to efficiently manage their block storage and drop blocks that have exceeded their lifetime.

This enhancement is expected to improve the overall efficiency of network communication and resource utilization in the Verity network.

# Encryption

## Cryptographic primitives used
   - All hashes are SHA3, truncated where sensible.
   - All signatures are ED25519
   - Fingerprints of either are truncated to 64 bit

  > Note: Signatures are very computationally expensive. Signing a block with ED25519 is roughly 20 times as expensive as hashing with SHA3, verifying the signature even 60 times. Thus whenever signatures are to be verified, the block challenge has to be verified first, in order to avoid creating a vector for Denial of Service (DoS).

**Key Distribution Field (`TYPE_KEY_DISTRIBUTION`):**

This type is used for fields that distribute a symmetric key for decryption of subsequent fields in the block.

1. The sender creates an ephemeral Curve25519 key pair.
2. The sender uses the ephemeral private key and the recipient's public key (obtained from their address) to derive a shared symmetric key using `crypto_scalarmult_curve25519`.
3. The sender uses the shared symmetric key to encrypt the subsequent fields in the block.
4. The field value for the `TYPE_KEY_DISTRIBUTION` field is composed of the following parts:
   - The 32-byte ephemeral public key, which the recipient will need to derive the same shared symmetric key.
   - A truncated 8-byte (64-bit) hash of the recipient's public key, so the recipient can identify that they are the intended recipient.

**Shared Key Field (`TYPE_SHARED_KEY`):**

This type is used for fields that deliver a symmetric key to the recipient. These fields can be placed within `TYPE_ENCRYPTED` sections and can be included multiple times to deliver multiple keys.

The field value for the `TYPE_SHARED_KEY` field is a 32-byte symmetric key, which the recipient should add to their key store for decrypting future messages.

**Encrypted Block (`TYPE_ENCRYPTED`):**

This type is used for fields that contain encrypted data. The encryption is done using a symmetric key, which could be distributed in the same block or derived from a key in the recipient's key store.

1. The field starts with an 8-byte (64-bit) hash of the symmetric key used for encryption. The recipient uses this hash to identify the correct key for decryption.
2. The rest of the field contains the encrypted data.

**1:1 Messages:**

For 1:1 messages, the sender creates a single block with the recipient's public key and the message payload in the `TYPE_ENCRYPTED` section. This section is encrypted with a symmetric key derived using `crypto_scalarmult_curve25519` and the ephemeral key pair. The block also contains a `TYPE_KEY_DISTRIBUTION` field with the ephemeral public key and the hash of the recipient's public key.

**1:n Messages:**

For 1:n messages, the sender creates multiple blocks, one for each recipient. Each block contains a `TYPE_KEY_DISTRIBUTION` field with an ephemeral public key (different for each block) and the hash of the recipient's public key. The `TYPE_ENCRYPTED` section of each block can contain the same or different payloads for each recipient. 

Additionally, the sender can include one or more `TYPE_SHARED_KEY` fields within the `TYPE_ENCRYPTED` section of each block. These fields contain symmetric keys that the recipients should add to their key store for decrypting future messages. This allows the sender to establish multiple shared keys with each recipient in a single block.

This comprehensive system allows for secure, efficient, and flexible communication, supporting both 1:1 and 1:n messages while minimizing metadata leakage and block size. It also provides a robust mechanism for nodes to quickly identify and retrieve relevant data.

## Design
### Logo
![](img/vera_150px_nobg.png)

The dove Vera (short for Veracity) is the logo of Verity. The dove not only signifies peace, harmony, and purity, but also symbolizes the free spirit of a decentralized network that cannot be caged or controlled, much like the dove itself.
### Names
#### Verity
Verity was chosen as the name of the project. It aligns with the project goals and is conscise, yet not too common. Verity is another word for "truth". It's shorter and simpler than Veracity, but similar in meaning.

#### Veracity
This word means "truthfulness" or "accuracy", which could refer to the authenticity and integrity of the blocks in the network. It's an uncommon word, which could make the project stand out, but it may also be less immediately understandable to some users.

## Outlook
### Network
- `Light Nodes`: Besides full nodes with full replication one can also operate light nodes that only request blocks on demand. They should prefer to connect to full nodes and communicate their status as network leaves.
- `DHT Nodes`: Another extension could be DHT nodes. Instead of aiming for full replication, these nodes just replicate a portion of the block-space within their DHT address range. They have a bit less utility to the network, but also can operate with less resources.
- `Merkle Patricia Trie`: To improve efficiency during synchronization we can store all hashes in an MPT. This would allow efficient comparison and synchronization with a time complexity of O(log(n)). Likely advisable to scale beyond a million blocks per day.
### Client
- `Reference Client`: The reference client is to be written in TypeScript and support a WebSocket transport. This will allow porting the client to the web for easier access. PWA could be an option, especially for light nodes.
### Features
- `Accounts`: Identities will be implemented through asymmetric cryptography. Users can create one or more public/private key pairs and use them to receive direct messages addressed to the hash of their public key, as well as to sign their messaged.

### Mutable User Blocks (MUBs)

Mutable User Blocks (MUBs) are a special type of block in the Verity network that can be updated by their respective owners. This functionality provides users with the flexibility to change the content of these blocks while preserving their identity within the network.

#### Specification

MUBs are similar to standard blocks, but with an additional field:

1. **Public Key**: This is the user's public key. It serves to verify the signature of the block. The hash of the public key is used to track the block within the network and as the key for the MPT. Their full hash still serves to verify the challenge of the block.

The content of a MUB can be updated by the user, and the updated block is signed with the user's private key. The signature can be verified with the public key in the block. When a MUB is updated, the timestamp is set to the current time. This timestamp serves as the version number for the block. The block with the latest timestamp is considered the most recent version.

#### Synchronization

Synchronization of MUBs leverages the Merkle Patricia Trie (MPT) structure, allowing efficient comparison and synchronization of blocks with a time complexity of O(log(n)).

When two nodes synchronize, they compare the root hash of their MPTs. If the hashes are different, this indicates that the nodes have a different set of blocks. The nodes can then recursively compare the hashes of their children, continuing down the tree, until they identify the blocks that differ. This allows the nodes to find the specific blocks that need to be updated, without having to compare every single block hash.

For MUBs, the timestamp is incorporated into the block hash stored in the MPT. If a MUB is updated and its timestamp changes, its hash will change, and the change will propagate up the MPT. Nodes can then identify the updated block when synchronizing their MPTs.

#### Conflict Resolution

In the event of a conflict where different versions of the same MUB exist within the network with the same timestamp, the version with the "higher" block hash is considered the most recent. "Higher" can be defined in various ways - for example, you might interpret the hash as a big-endian number and choose the block with the larger number, or you could choose the block with the lexicographically later hash when interpreted as a string.

This method is arbitrary and doesn't inherently favor any particular block, but it provides a deterministic way to decide between two versions of a block with the same timestamp. The choice of "higher" as larger numeric value or later lexicographic value doesn't affect the security or functionality of the network, but should be consistent across all nodes.

  > The extension Block Lifetime Function will enable an improved conflict resolution where the exact remaining lifetime of a block can be calculated and used to arbitrate between conflicting blocks. Longer lifetime is always to be preferred.

#### Implementation

Implementation of MUBs requires changes to the block handling and network synchronization code to accommodate the additional fields and the different method of tracking and synchronizing blocks. The MPT data structure must also be implemented and maintained by each node.

### Immutable Persistence Blocks (IPBs)

Immutable Persistence Blocks (IPBs) are a distinct type of block in the Verity network. Unlike regular blocks that expire after 7 days, and Mutable User Blocks (MUBs) that can only be extended in their lifetime by their respective owners, IPBs are static and their content cannot be updated once created. However, their lifespan can be extended by any network participant, allowing them to potentially exist in perpetuity.

#### Specification

IPBs are similar to standard blocks and MUBs, but with a unique identification method:

1. **Partial Hash Key**: Each IPB is tracked under a key that is derived by hashing most of the block content, excluding the date and the padding/nonce. This guarantees that the same stored data will always result in the same key, thereby preserving block identity even when their lifespan is extended. Their full hash still has to meet the regular challenge requirements.
 > TODO: Consider swapping the header byte with the date bytes for easier sequential hashing of IPBs. Ideally their key can be derived in one go.

#### Extension of Lifespan

Any network participant can sponsor an extension of the lifespan of an IPB by setting the date to the current date and solving the nonce to meet the hashcash requirement. This process results in a new block with the same key (due to the identical content) but a newer date, effectively replacing the older version of the block in the network. As long as any client appreciates the content and occasionally renews the date, these blocks could theoretically exist indefinitely.

#### Conflict Resolution

In the event of a conflict where different versions of the same IPB exist within the network with the same timestamp and same challenge level, the version with the "higher" block hash is considered the most recent. "Higher" can be defined in various ways, such as interpreting the hash as a big-endian number and choosing the block with the larger number, or interpreting the hash as a string and choosing the block with the lexicographically later hash. This deterministic method ensures a fair resolution of conflicts and doesn't inherently favor any particular block.

 > See MUB conflict resolution

## Block Lifetime Function

In the Verity network, the lifetime of blocks can be extended by increasing the hashcash challenge level. The function that determines the block lifetime, given the hashcash challenge level, is designed to provide a balance between computational investment and the extension of block lifetime. 

### Function Definition

The function that determines the block lifetime is given by:

$$f(x) = \frac{{d_{1} - d_{2}}}{{\log_2(c_{1}) - \log_2(c_{2})}} \cdot \log_2(x) + \frac{{d_{1} \cdot \log_2(c_{2}) - d_{2} \cdot \log_2(c_{1})}}{{\log_2(c_{2}) - \log_2(c_{1})}}$$

where:

- $x$ is the hashcash challenge level,
- $d_{1}$ and $d_{2}$ are the lower and upper bounds for the block lifetime, respectively, and
- $c_{1}$ and $c_{2}$ are the lower and upper bounds for the hashcash challenge level, respectively.

### Plot ###
![](img/lifetime_plot.png)

### Function Properties

The block lifetime function has several key properties that make it well-suited for its role in the Verity network:

1. **Growth Rate**: The function exhibits sub-linear growth. This means that as the hashcash challenge level increases, the block lifetime also increases, but at a decreasing rate. This property ensures that while investing more computational resources can extend the block lifetime, there are diminishing returns for each additional bit in the hashcash challenge level.

2. **Monotonicity**: The function is strictly increasing for $x > 0$ if $d_{1} < d_{2}$ and $c_{1} < c_{2}$. This means that a higher hashcash challenge level will always result in a longer block lifetime.

3. **Continuity and Differentiability**: The function is continuous for $x > 0$ and differentiable for $x > 0$, which means it has no breaks, jumps, or sharp turns for $x > 0$. This ensures that small changes in the hashcash challenge level lead to small changes in the block lifetime.

4. **Bounds**: The function correctly maps a hashcash challenge level of $c_{1}$ bits to a block lifetime of $d_{1}$ days, and a challenge level of $c_{2}$ bits to a block lifetime of $d_{2}$ days. This allows the network to control the minimum and maximum block lifetimes.

# Specification Version
* `07-25-2023: Version 0.1.0:` Initial draft
* `08-03-2023: Version 0.1.1:` IPB, lifetime function, advanced block keys, special block type
