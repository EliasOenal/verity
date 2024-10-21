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

  > Also see [Cube Lifetime Function](cube.md#cube-lifetime-function)

# Node types
- `Full Nodes` replicate all Cubes on the entire network.
  They form the backbone of the Verity network and users are encouraged to
  operate as full nodes whenever possible.
- `Light Nodes` only request cubes on demand.
  Verity applications are usually expected to operate as light nodes as users
  cannot be expected to have the bandwidth and storage to operate a full node,
  especially on mobile devices.


# Network Communication
See the current [wire format 1.0 specification](wireFormat1.md).


# Encryption
## Cryptographic primitives used
   - All hashes are SHA3, may be truncated where sensible.
   - All signatures are ED25519
   - Fingerprints of either are truncated to 64 bit

  > Note: Signatures are very computationally expensive. Signing a cube with ED25519 is roughly 20 times as expensive as hashing with SHA3, verifying the signature even 60 times. Thus whenever signatures are to be verified, the cube challenge has to be verified first, in order to avoid creating a vector for Denial of Service (DoS).

## Cryptography in the core layer
The core layer uses cryptographic hashing to ensure Cube integrity and derive
the keys for frozen Cube and PICs. It also uses signatures to ensure authenticity
and derive the keys for MUCs and PMUCs.

It does not handle encryption; this is deferred to the CCI layer.

## Cryptography in CCI
See [CCI Encryption](cciEncryption.md).

Applications are encouraged to always use CCI encryption when possible.
If in doubt, encrypt.

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
- `Bloom filters`: To further improve efficiency light nodes receive bloom filters of connected nodes in order to determine which peers to request cubes from.
- `DHT Nodes`: Another extension could be DHT nodes. Instead of aiming for full replication, these nodes just replicate a portion of the cube-space within their DHT address range. They have a bit less utility to the network, but also can operate with less resources.
- `Merkle Patricia Trie`: To improve efficiency during synchronization we can store all hashes in an MPT. This would allow efficient comparison and synchronization with a complexity of O(log(n)). Likely advisable to scale beyond a million cubes per day.

When two nodes synchronize, they compare the root hash of their MPTs. If the hashes are different, this indicates that the nodes have a different set of cubes. The nodes can then recursively compare the hashes of their children, continuing down the tree, until they identify the cubes that differ. This allows the nodes to find the specific cubes that need to be updated, without having to compare every single cube hash.

### Client
- `Reference Client`: The reference client is to be written in TypeScript and supports a WebSocket transport. This will allow porting the client to the web for easier access. PWA could be an option, especially for light nodes.
> TODO: PWAs prohibit self-signed certificates. By switching to WebRTC we can avoid this issue and also gain NAT traversal.
### Features
- `Accounts`: Identities will be implemented through asymmetric cryptography. Users can create one or more public/private key pairs and use them to receive direct messages addressed to the hash of their public key, as well as to sign their messaged.

