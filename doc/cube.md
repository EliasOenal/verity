## Cube 1.0 types
Challenge verification is always the SHA3 hash of the whole cube.

| Data               | Size (bits/bytes) | Cube | PIC | MUC | PMUC |
|--------------------|-------------------|------|-----|-----|------|
| Cube Version       | 4 bits            | H    | H   | S   | S    |
| Feature Bits       | 4 bits            | H    | H   | S   | S    |
| Payload            | Remaining Space   | H    | H   | S   | S    |
| Notify (Optional)  | 32 bytes          | H    | H   | S   | S    |
| PMUC Update Count  | 4 bytes           | -    | -   | -   | S    |
| Public Key         | 32 bytes          | -    | -   | S   | S    |
| Date               | 5 bytes           | H    | OH  | S   | OS   |
| Signature          | 64 bytes          | -    | -   | OS  | OS   |
| Nonce              | 4 bytes(variable) | H    | OH  | OS  | OS   |

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

### Implementation notes
#### Cube types
| Cube type   | Implemented |
| Cube (dumb) | yes         |
| PIC         | no          |
| MUC         | yes         |
| PMUC        | no          |

Notify field not implemented yet.
Current implementation does not support optional positional fields, though we
could emulate them as separate field definition schemes.

# Version and feature bits fields
Implemented and interpreted as a single one byte field defining which field
definition scheme we need to use.

#### Padding
Two padding fields, one of variable size and one of fixed size 0 are implemented
at the core layer rather than CCI. This is so the core is able to sculpt valid
cubes which we use for testing. Server-only nodes will ignore these fields and
will not do any sculpting, except when we implement commission sculpting.

#### Nonce field size
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
size. Dumb cubes will stay invalid forever (except in the unlikely case that
difficulty decreases again before they drop out of the network). Smart cubes can
get their challenge updated by eligible nodes unless the new difficulty happens
to exceed the reserved nonce space.

#### Payload
Core contains a TLV Payload field for testing. The CCI layer may adopt or
replace this pre-defined field.