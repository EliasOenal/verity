# CCI Encryption
Both Verita and single Cubes can optionally be encrypted using CCI encryption.

Cubes containing CCI encrypted data contain a single ENCRYPTED field
as their only CCI field, spanning the whole available Cube space and complete
filled with data indistinguishable from random.

The single ENCRYPTED field contains different kinds of encrypted data, which are
not marked by a header.  These are, in this order:

1) Sender's public key, from a randomly generated key pair only to be used once
2) Random nonce
3) Key distribution slot:
   A random symmetric encryption key, symmetrically encrypted with a temporary
   key derived using X25519 between the sender and one of the recipients.
   Key distribution slots have no verification MAC.
4) Any number of further key distribution slots
5) MAC-verifiable encrypted payload

All subfields except the MAC-verifiable encrypted payload are optional, however
only certain combinations of subfields are allowed. Those allowed combinations
define four different kinds of encrypted Cubes, which are however
indifferentiable before decryption. The receiver will still be able to decrypt
all four variants by following a simple and specific trial-and-error algorithm
(see [Decryption](#decryption) below).

In the end, the recipient's goal is to decrypt the encrypted payload contained
within the ENCRYPTED field. This data contains compiled CCI fields which can
be expanded upon decryption.

## CCI encryption Cube types
These are the different kinds of encrypted Cubes featuring the following
unmarked ENCRYPTED sub-fields, listed from the most basic one (containing
only the encrypted payload) to the most sophisticated one (containing all
of the subfields described above):

### Continuation Cubes
1) MAC-verifiable encrypted payload

### Start-of-Veritum Cubes (assuming pre-shared secret)
1) Random nonce
2) MAC-verifiable encrypted payload

### Start-of-Veritum Cubes (establishing new shared secret with a single recipient)
1) Sender's public key
2) Random nonce
3) MAC-verifiable encrypted payload

### Start-of-Veritum Cubes (including key distribution to multiple recipients)
1) Sender's public key
2) Random nonce
3) Any number of key distribution slots
4) MAC-verifiable encrypted payload

## Decryption
To decrypt a CCI-encrypted Cube, the recipient should attempt the following
steps, continuing on until the MAC-verifiable payload was decrypted successfully:

1) If the recipient suspects this Cube is a continuation of a previous Cube
   (e.g. because they have previously decrypted a CONTINUED_IN relationship
   informing them so), attempt to decrypt as a Continuation Cube:
    1) Calculate the hash of the previous Cube's nonce to use as this Cube's nonce.
    2) Treat the whole ENCRYPTED field as MAC-verifiable encrypted payload
       and attempt to decrypt it using the same key as the previous Cube
       and the nonce just calculated.
2) If the recipient suspects they already possess a shared secret with the sender,
   restart processing the Cube attempting to process it as a Start-of-Veritum
   Cube without key agreement information:
    1) Treat the start of the ENCRYPTED field as a random nonce and remove
       it from the field.
    2) Treat the rest of the ENCRYPTED field as MAC-verifiable encrypted
       payload and attempt to decrypt it using the pre-shared secret and the
       nonce just obtained.
3) Restart processing the Cube attempting to process it as a Start-of-Veritum
   Cube directed at a single recipient:
   1) Treat the start of the ENCRYPTED field as the sender's public key
      and remove it from the field.
   2) Treat the start of the remaining ENCRYPTED field as a random nonce
      and remove it from the field.
   3) Derive a symmetric key using X25519 between the sender's public key
      and their own private key.
   4) Attempt to decrypt the remaining data as MAC-verifiable encrypted
      payload using the pre-shared secret and the nonce just obtained.
4) Continue processing the Cube attempting to process it as a Start-of-Veritum
   Cube with key distribution information:
   1) Treat the start of the remaining ENCRYPTED field as an encrypted
      symmetric group key and remove it from the field.
   2) Symmetrically decrypt the encrypted group key using the
      X25519-derived key (this will always "succeed" as there is no
      verification MAC).
   3) Attempt to decrypt the remaining data as MAC-verifiable encrypted
      payload using the symmetric group key and the nonce obtained before.
   4) Repeat from step 4 unless there is no longer enough data in the ENCRYPTED
      field to represent another key distribution slot as well as one encrypted
      RELATES_TO field.
5) Discard the Cube as not decryptable.

This decryption algorithm has the following properties:
* Simple and universal, works for any well-formed CCI encrypted message
* Deterministic, i.e. the receiver can always either decrypt the message,
  or determine that it is not decryptable.
* Cheap, as it requires a maximum of one key derivation, and does not require
  key derivation for well-formed messages based on a known shared secret.
  It also only requires a number of symmetric operations (decryptions, hashes)
  in the same order as the number of key distribution slots.

## Handling large numbers of recipients
All key distribution information must always be included in the first Cube
as the relationship field linking to the next Cube is already encrypted.

If the number of recipients is too large to fit all their key distribution slots
in a single Cube, different groups of recipients are issued different
Start-of-Veritum Cubes. All of these will contain an encrypted CONTINUED_IN
reference to the same Continuation Cube as prescribe by the Veritum continuation
spec.

This will effectively split the encrypted Veritum into different continuation
chains, ensuring that each chain always contains all key distribution
information in the first Cube. At the same time, all of these chains will
only differ in their first Cube, while all continuation Cubes are shared.

All of these parallel start Cubes should contain the same number of key
distribution slots. If required, additional key distribution slots containing
random data should be inserted at random positions to ensure uniformity.

## Further best practices
- It is discouraged but possible to include any other plain text content in
  encrypted content Cubes, including application identifiers.
- To prevent non-recipients from learning information about encrypted Cubes by
  their common or close timestamps, senders should chose a random timestamp
  within the current UTC calendar day for each encrypted Cube.
- To increase uniformity, encrypted Cubes should always use the PIC Cube type
  without notify field.

## Security goals and considerations
Non-recipients should not be able to infer any information about the encrypted
message, including:
1) its content
2) its size
3) its recipients
4) its number of recipients
5) its timestamp

The timestamp is an issue as it's required by the Veritum core.
Using an exact timestamp an attacker could also infer information about
a message's size assuming that chunks belonging to the same message
have the same or a very similar timestamp. We mitigate this by selecting
a random timestamp within the current UTC calendar; we do not use a sliding
24h window to avoid a gaussian distribution of timestamps. This blur's each
message's timestamp and size by mingling it with all other messages sent in
the same day, which should be enough.
