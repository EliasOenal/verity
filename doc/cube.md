# Cube specification
Each Cube has a total size of 1024 bytes.
The current version of the Cube specification is 1.0 and is indicated by each
Cube starting in 0b0001.

## Cube types

### Mutable User Cubes (MUCs)

Mutable User Cubes (MUCs) are a smart type of cube in the Verity network that can be updated by their respective owners. This functionality provides users with the flexibility to change the content of these cubes while preserving their identity within the network.

#### Specification

MUCs are similar to standard cubes, but with additional fields to implement ownership:

1. **TYPE_SMART_CUBE**: Indicating the cube is a MUC.

2. **TYPE_PUBLIC_KEY**: This is the user's public key. It serves to verify the signature of the cube. The public key is used to track the cube within the network, like the cube hash does for regular cubes. The cube hash of a MUC still serves to verify the challenge of the cube, keeping challenge verification consistent among cube types. A MUC may contain more than one public key, the fingerprint in the signature field is used to identify the correct key for verification.

3. **TYPE_SIGNATURE**: This is the user's signature of the cube, which is verified with the key in the TYPE_PUBLIC_KEY field. This proves ownership of the cube. For MUCs this field is defined to be the last field in the cube, ending exactly at the last byte of the cube. This ensures that the signature covers the entire cube and prevents unauthorized modifications.

#### Functionality
The content of a MUC can be updated by the user, and the updated cube is signed with the user's private key. The signature can be verified with the public key in the cube. When a MUC is updated, the timestamp is set to the current time. This timestamp serves as the version number for the cube. The cube with the latest timestamp is considered the most recent version.

#### Conflict Resolution
In the event of a conflict where different versions of the same MUC exist within the network with the same timestamp, the mainline client will keep the local cube. Clients may optionally compare cube hashes and favor the cube with the lexicographically higher hash. This deterministic method ensures a fair resolution of conflicts and doesn't inherently favor any particular cube.

### Immutable Persistence Cubes (IPCs)

Immutable Persistence Cubes (IPCs) are a distinct type of cube in the Verity network. Unlike regular cubes that expire after 7 days, and Mutable User Cubes (MUCs) that can only be extended in their lifetime by their respective owners, IPCs are static and their content cannot be updated once created. However, their lifespan can be extended by any network participant, allowing them to potentially exist in perpetuity.

#### Specification

IPCs are similar to standard cubes and MUCs, but with a unique identification method:

1. **Partial Hash Key**: Each IPC is tracked under a key that is derived by hashing most of the cube content, excluding the date and the padding/nonce. This guarantees that the same stored data will always result in the same key, thereby preserving cube identity even when their lifespan is extended. Their full hash still has to meet the regular challenge requirements.
 > TODO: Consider swapping the header byte with the date bytes for easier sequential hashing of IPCs. Ideally their key can be derived in one go.

#### Extension of Lifespan

Any network participant can sponsor an extension of the lifespan of an IPC by setting the date to the current date and solving the nonce to meet the hashcash requirement. This process results in a new cube with the same key (due to the identical content) but a newer date, effectively replacing the older version of the cube in the network. As long as any client appreciates the content and occasionally renews the date, these cubes could theoretically exist indefinitely.

#### Conflict Resolution

In the event of a conflict where different versions of the same IPC exist within the network, the cube lifetime function is used to determine the cube with the longest lifespan. The cube with the longest lifespan is considered the most recent version and is to be favored.

## Core Cube fields
Challenge verification is always the SHA3 hash of the whole cube.

| Data               | Size (bits/bytes) | FROZEN | PIC | MUC | PMUC |
|--------------------|-------------------|------- |-----|-----|------|
| Cube Version       | 4 bits            | H      | H   | S   | S    |
| Feature Bits       | 4 bits            | H      | H   | S   | S    |
| Payload            | Remaining Space   | H      | H   | S   | S    |
| Notify (Optional)  | 32 bytes          | H      | H   | S   | S    |
| PMUC Update Count  | 4 bytes           | -      | -   | -   | S    |
| Public Key         | 32 bytes          | -      | -   | S   | S    |
| Date               | 5 bytes           | H      | OH  | S   | OS   |
| Signature          | 64 bytes          | -      | -   | OS  | OS   |
| Nonce              | 4 bytes           | H      | OH  | OS  | OS   |

-: Not present for this type of cube.<br>
H: This is hashed to derive cube key.<br>
OH: Omitted and not hashed for cube key.<br>
S: Signed with the cube's private key, public key is cube key.<br>
OS: Omitted and not signed with the cube's private key.

### Feature Bits
Bits from least to most significant:

| Bit | Name      | Description |
|-----|-----------|------------------------------------------------------------|
| 0-1 | Cube Type | Indicates whether Cube (0), PIC (1), MUC (2) or PMUC (3).  |
| 2   | Reserved  | Future use.                                                |
| 3   | Notify    | Indicates whether Notify field is present.                 |


## Cube Lifetime Function

In the Verity network, the lifetime of cubes can be extended by increasing the hashcash challenge level. The function that determines the cube lifetime, given the hashcash challenge level, is designed to provide a balance between computational investment and the extension of cube lifetime.

### Epochs

The cube lifetime is measured in epochs, where each epoch represents 5400 Unix seconds (90 minutes), resulting in 16 epochs per day. This aligns with the nibbles in the branches of the Merkle Patricia Trie (MPT), resulting in one new branch node per day.

### Cube Retention

Cubes are to be retained while the local system epoch is within the span between the cube's sculpting epoch and the retention limit. The retention limit is calculated by adding the cube's lifetime to the cube's sculpting epoch. If the local system epoch is outside this span, the cube is to be dropped.

### Function Definition

The function that determines the cube lifetime is given by:

$$ f(x) = \left( \frac{e_2 - e_1}{c_2 - c_1} \right) x + \left( e_1 - \left( \frac{e_2 - e_1}{c_2 - c_1} \right) c_1 \right) $$

where:

- $x$ is the hashcash challenge level,
- $e_{1}$ and $e_{2}$ are the lower and upper bounds for the cube lifetime, respectively, and
- $c_{1}$ and $c_{2}$ are the lower and upper bounds for the hashcash challenge level, respectively.

### Plot
![](../img/lifetime_plot.png)

### Function Properties

The cube lifetime function has several key properties that make it well-suited for its role in the Verity network:

1. **Growth Rate**: The linear function establishes a direct proportion between the hashcash challenge level and the cube lifetime. This means that for every increase in the challenge level by one bit, there is a constant increase in the cube lifetime. However, due to the exponential nature of the hashcash algorithm, where each additional bit in the challenge level doubles the complexity of the computation required, this linear correlation between epochs and challenge bits results in an exponential growth in computational effort. Consequently, while the cube lifetime increases linearly, the actual computational work required to achieve this increase grows exponentially, reflecting the intrinsic complexity of the hashcash challenge.

2. **Monotonicity**: The function is strictly increasing for $x > 0$ if $e_{1} < e_{2}$ and $c_{1} < c_{2}$. This means that a higher hashcash challenge level will always result in a longer cube lifetime.

3. **Continuity and Differentiability**: The function is continuous for $x > 0$ and differentiable for $x > 0$, which means it has no breaks, jumps, or sharp turns for $x > 0$. This ensures that small changes in the hashcash challenge level lead to small changes in the cube lifetime.

4. **Bounds**: The function correctly maps a hashcash challenge level of $c_{1}$ bits to a cube lifetime of $e_{1}$ epochs, and a challenge level of $c_{2}$ bits to a cube lifetime of $e_{2}$ epochs. This allows the network to control the minimum and maximum cube lifetimes.


## Implementation notes
### Cube types
| Cube type   | Implemented |
| Frozen (basic) | yes         |
| PIC         | no          |
| MUC         | yes         |
| PMUC        | no          |

Notify field not implemented yet.
Current implementation does not support optional positional fields, though we
could emulate them as separate field definition schemes.

### Version and feature bits fields
Implemented and interpreted as a single one byte field defining which field
definition scheme we need to use.

### Padding
Two padding fields, one of variable size and one of fixed size 0 are implemented
at the core layer rather than CCI. This is so the core is able to sculpt valid
cubes which we use for testing. Server-only nodes will ignore these fields and
will not do any sculpting, except when we implement commission sculpting.

### Nonce field size
The nonce field size reserved in the current implementation is 4 bytes.

The nonce field size, even though it is positional, is by its very nature of
variable size as, on the receiving node, it is only ever used to check whether
the last n bits are 0, where n is this node's currently required difficulty. If
the cube does not meet this difficulty requirement, it will be discarded
silently.

The current difficulty level could, by its nature, vary between nodes, for
example as a function of available local storage, awarding higher difficulty
cubes better propagation without imposing a hard barrier.
This is however not currently implemented;
currently, difficulty is a static, network-wide, hardcoded parameter.

If difficulty increases, all old cubes will become invalid regardless of field
size. Frozen cubes will stay invalid forever (except in the unlikely case that
difficulty decreases again before they drop out of the network). Smart cubes can
get their challenge updated by eligible nodes unless the new difficulty happens
to exceed the reserved nonce space.

### Payload
Core contains a TLV Payload field for testing, which is adopted into the CCI
layer.
