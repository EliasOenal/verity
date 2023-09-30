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
| Nonce              | 8 bytes           | H    | OH  | OS  | OS   |

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
