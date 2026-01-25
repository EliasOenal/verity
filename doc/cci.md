# Introduction

Verity operates as the core of a decentralized system, functioning as the foundational storage layer leveraging unique data structures known as "cubes." Each cube encapsulates 1kB of payload data, serving as the fundamental unit of information exchange synchronized across participating nodes in the Verity network.

To streamline the interaction between various applications and these cubes, the Common Cube Interface (CCI) was developed. It provides a standardized format for the payload data within a cube, enabling a structured and consistent approach to data representation. This standardization fosters interoperability among different applications, facilitating a smoother and more coherent data transmission landscape in the Verity network.

# Common Cube Interface (CCI)

The Common Cube Interface (CCI) is a standardized payload format designed to facilitate interoperability between different applications built on the Verity network. By adhering to a common set of rules for structuring the payload data within a cube, applications can more easily share and understand the data being transmitted.

## Overview

CCI describes a Type-Length-Value data structure within a Cube's Payload area.
It also defines a common set of type numbers for standardized fields. This ensures a harmonized approach to handling payload data while allowing applications the flexibility to introduce their custom fields based on specific requirements.

### TLV format

1. **Type (6 bits)**: Each field starts with a one-byte type identifier, followed by a length (types of static length may omit this) and the actual value. The type is a 6-bit identifier, and the length, if present, is encoded as a 10-bit integer, both packed into a two-byte header. The length is encoded as big endian.

2. **Length (10 bits, optional)**: This is the length of the value in bytes. For fields with a fixed length this entry is omitted (value will start at the next byte boundary) and the length is implicitly known. For types with variable length, this field specifies the length of the value.

3. **Value (variable length)**: This is the actual data. The length of this field is specified by the length field or is implicitly known based on the type.


### Common Cube Interface (CCI) Field Specifications

#### Field type space
General partition of type space:
| Range | Use                                                                                                |
|-------------|----------------------------------------------------------------------------------------------|
| 0x00 - 0x0F | Common technical fields, "Core CCI", 0x00 being a CCI-friendly field to opt out of CCI       |
| 0x10 - 0x1F | Common content-descriptive fields                                                            |
| 0x20 - 0x2F | Reserved (may later be used for further CCI fields or released for application-specific use) |
| 0x30 - 0x3F | Application-specific fields (must be variable length)                                        |

#### Core CCI fields
| Type (Hex)  | Length | Field Name             | Description |
|-------------|--------|------------------------|-------------------------------------------------------------------------------------|
| 0x00        |      0 | Non-CCI Indicator      | Indicates that data following this field is not CCI parseable; CCI parsers should stop parsing here. Should also be used before any kind of padding. |
| 0x01        |    var | Application Identifier | Unique identifier for the application.                                              |
| 0x02        |    var | Encrypted content      | Contains encrypted data, which once decrypted should represent CCI-compatible fields. This field may only be used once per Cube or Veritum. |
| 0x03        |     24 | Encryption Nonce       | The nonce used for symmetric encryption; must always be provided alongside encrypted content. This field may only be used once per Cube or Veritum. |
| 0x04        |     16 | Encryption MAC         | (Currently UNUSED as libsodium includes the MAC with the ciphertext) The MAC used for symmetric encryption; must always be provided alongside encrypted content. This field may only be used once per Cube or Veritum. |
| 0x05        |     32 | Encrypted symmetric key| In Cubes directed at multiple recipients, this provides each individual recipient with the key. |
| 0x06        |        | Encryption public key  | Published to allow sending of encrypted messages. Senders of encrypted messages must also supply their encryption public key if it is not already known to the receiver.    |
| 0x07        |    var | MUC/PMUC KDF hint/id   | Clients may store a value aiding in the re-calculation of the MUC/PMUC private key from a master key. (e.g. key derivation using BIP-44 or libsodium's crypto_kdf.) |
| 0x0A        |      6 | Date (CCI)             | A five byte unix timestamp preceeded by a single byte purpose code describing the meaning of this timestamp (see below). |
| 0x04 - 0x0F |    TBD | Reserved               | Reserved for future standard fields that might be defined as the CCI evolves.       |

Standardized fields are defined to establish a universal foundation for payloads, ensuring a consistent and straightforward interpretation across different applications.

#### Common content-descriptive fields
| Type (hex)  | Field name             | Len | Description                                                                         |
|-------------|------------------------|-----|-------------------------------------------------------------------------------------|
| 0x10        | Payload                | var | Denotes the "main" or most relevant data, the raison d'être for this Cube.          |
| 0x11        | Content name           | var | Concise, plain text description of this Cube's Payload, e.g. "Chancellor on brink of second bailout for banks" or "Charpentier - Te Deum, Prelude.mp3" |
| 0x12        | Description            | var | A short summary of this Cube's Payload, e.g. a textual descriptionm of non-text content, a summary or an article's lead paragraph. Should be plain text with optional markdown. |
| 0x13        | Related to             |  33 | A single byte code denoting commonly used relationships this cube may have with other cubes, plus the key of the referred Cube |
| 0x14        | User name              | var | The name of the user associated with this Cube, usually it's author. Mainly used in Identity Cubes (see below).
| 0x15        | Media type (short)     |   1 | Type of content in this Cube's Payload field. This short field contains a single byte code denoting commonly used media types. |
| 0x16        | User avatar            | var | Describes an auto-generated, guaranteed safe to show avatar for this user |
| 0x1F        | Reserved (padding)     | var | The reference implementation currently precedes padding by this code. Padding must always follow the 0x00 CCI_END marker, thus this TLV field will be disregarded anyway. |

### CCI date fields
A five byte unix timestamp preceeded by a single byte purpose code describing
the meaning of this timestamp.

CCI-compliant PICs should feature a CCI date field with pupose code 1
(creation time) as the core date field will change whenever the PIC's lifetime
is extended.

#### Date purpose codes
| Code | Meaning                                                               |
|------|-----------------------------------------------------------------------|
|    1 | Created on                                                            |
|    2 | Valid from                                                            |
|    3 | Valid until                                                           |
|    4 | Expect update on                                                      |

Codes 128 and above are reserved for application-specific usage.

### CCI media type short codes
Currently only two defined:
1) Text -- plain or markdown
2) JPEG

Proposed change:
* make field variable length
* interpret lengths of one or three bytes as short codes and anything longer as MIME type
* try to figure out if there is already a commonly used list of three-byte or less short codes for media types, otherwise define our own

### CCI Cube relationships
Denotes that a Cube is in some way related to another Cube.

This field's content is always 33 bytes long; one byte describes the
relationship type while the remaining bytes contain the key to the referred
Cube.

Proposed change to discuss: Make field variable length and allow referred key
to be shortened.

Currently defined relationship types:

| Code | Name               | Description                                      |
|------|--------------------|--------------------------------------------------|
| 1    | CONTINUED_IN       | The information contained in this Cube is continued in the referred Cube. |
| 2    | INTERPRETS         | This Cube provides some information aiding the technical interpretation (e.g. parsing) of the referred Cube. For example, it may contain the keys to decrypt an encrypted Cube. |
| 3    | REPLY_TO | This Cube is a semantic response to the referred Cube. |
| 4    | QUOTATION | This Cube semantically refers to the referred Cube without being a direct response to it. |
| 5    | MYPOST | The referred Cube has the same author as this Cube. |
| 6    | MENTION | The referred Cube must contain a CCI Identity. This Cube's content semantically refers to the user described there. |
| 7    | AUTHORHINT | The referred Cube must contain a CCI Identity, which is claimed to be this Cube's author. Note that this information is not guaranteed to be true and should never be trusted as such; it is a hint only. Authenticated authorship information is provided by the CCI Identity through MYPOST rels pointing to their content. User agents should only use this hint to check if such a MYPOST rel exists, and disregard the AUTHORHINT otherwise. There must be no more than a single AUTHORHINT, and in multi-Cube Verita it must be placed in the first Cube. |
| 11   | REPLACED_BY | This Cube should be disregarded and the referred Cube should be fetched instead. |
| 12   | REPLACES | This Cube supersedes the referred Cube. |
| 71   | ILLUSTRATION | The referred Cube contains and image that should be presented alongside this Cube's content. If this Cube describes a CCI Identity, then the referred Cube contain's this Identity's profile picture. User agents should exercise caution and refrain from displaying such referred images by untrusted Identites. |
| 72   | KEY_BACKUP_CUBE | The referred Cube provides a way for its owner to restore it's own private key. This is currently neither used nor specified. |
| 73   | SUBSCRIPTION_RECOMMENDATION_INDEX | The referred Cube has the same author as this Cube and is advertised as containing SUBSCRIPTION_RECOMMENDATION relationship fields. |
| 81   | SUBSCRIPTION_RECOMMENDATION | The referred Cube must contain a CCI Identity. This Cube's author recommends content authored by the remote Identity to be displayed, in particular such content further referred to as MYPOST by the remote Identity. |

Codes 128 and above are reserved for application-specific usage.

**Next Cube Reference**: Contains the 32-byte key of the target cube. Facilitates the assembly of content spanning multiple cubes by concatenating the field prior to this field with the first field of the same type in the referenced cube. This may be chained multiple times for content of arbitrary length.

### CCI user identities
CCI Identites describe a particular user.
Identites must be stored in MUCs.

Identities populate standard CCI fields as described.

| Field | Usage |
|-------|-------|
| APPLICATION | Should start with "ID" and may be extended to denote that this Identity is used in conjunction with a particular application, e.g. "ID/ZW" |
| USERNAME    | The displayable name of this user |
| AVATAR      | Describes an auto-generated, guaranteed safe to show avatar for this user |
| RELATES_TO/ILLUSTRATION | A user-supplied profile picture. User agents should exercise caution and refrain from showing untrusted user's profile pictures as they are not guaranteed to be safe to show. |
| RELATES_TO/KEY_BACKUP_CUBE | Not currently implemented |
| RELATED_TO/SUBSCRIPTION_RECOMMENTATION | See CCI field description |
| RELATED_TO/SUBSCRIPTION_RECOMMENTATION_INDEX | See CCI field description |
| RELATED_TO/MYPOST | See CCI field description |

#### Safe to show avatars
The `User avatar` field describes an auto-generatable avatar which is guaranteed
to be safe to show. The field starts with a single byte avatar scheme code, with
all remaining bytes to be parsed as required by the avatar scheme.

\<Avatar scheme\>:\<scheme-specific description>

Defined schemes are (length includes scheme code):
| Code | Length | Name             | Description                                    | How to parse                  |
| 1    |      6 | multiavatar      | Auto-generated by the multiavatar lib          | Convert to hex string, then feed into lib |

# Vertium
Verita are Verity's high level informational units.
Most application should not deal with Cubes directly, but store and retrieve
any information in terms of Verita.
Verita can consist of one or multiple Cubes and are automatically segmented
and recombined as needed.
Verita can optionally be encrypted for one or multiple recipients.


# CCI Encryption
Both Verita and single Cubes can optionally be encrypted using
[CCI Encryption](cciEncryption.md).


# Custom Fields
Applications have two ways of suppplementing CCI with custom fields:
1) Applications can define custom fields starting from `0x30` to `0x3F`.
   These fields must be variable length.
2) Applications can place the CCI_END marker field (0x00). Any content following
   within the Cube will be ignored by pure CCI parsers and can be used to store
   application data in any application-defined format.

# Applications using CCI

# File Application

The file application is a specific implementation leveraging the Common Cube Interface (CCI) to facilitate the transmission and reception of files over the Verity network. It only supports PIC and PMUC cubes to prevent files from unexpectedly changing. It populates the `Application`, `Contentname`, `Relates_To` and `Payload` fields to form a simple linked list of Cubes that contain the file data.

**Application Identifier**: `file`

> **Note**: We should detect and reject loops in the linked list. This is a potential DoS vector.

# Chat Application

The chat application implements basic chat room functionality on the Verity network. It works by sending notify Cubes to a notify key that serves as a chat room. The nodes participating in the chat will retrieve the most recent Cubes and render them chronologically sorted. It populates the `Application`, `Relates_To` and `Payload` and `Username` fields.

They optionally may reference their identity MUC using the <strike>`MYPOST`</strike> (TODO: Define new field) field and signatures (using the identity MUC's key) as proof of authorship.

**Application Identifier**: `chat`

> **Note**: Reverse iterating the notify index of a full node would improve performance when fetching the most recent Cubes.

### Usage

When transmitting a file, the application should at minimum populate the filename and file content fields to ensure the recipient has the necessary data to reconstruct the file. The inclusion of MIME Type and metadata fields is encouraged to provide a richer set of information about the file, facilitating more nuanced handling and organization of files by the recipient application.

For files that exceed the payload capacity of a single cube, the application utilizes the "Next Cube Reference" field defined in the CCI to chain multiple cubes together, allowing for the seamless assembly of larger files.