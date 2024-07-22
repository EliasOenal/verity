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
Proposed repartition of type space:
0x00 - 0x0B: Common technical fields, "Core CCI", 0x00 being a CCI-friendly field to opt out of CCI
0x0C - 0x0F: Less common technical fields (multi-byte fields like 0x0C42)
0x10 - 0x1B: Common content-descriptive fields
0x1C - 0x1F: Less common content-descriptive fields (multi-byte fields like 0x1C42)
0x20 - 0x3F: Application-specific fields (must be variable length)

#### Core CCI fields
| Type (Hex)  | Length | Field Name             | Description |
|-------------|--------|------------------------|-------------------------------------------------------------------------------------|
| 0x00        |      0 | Non-CCI Indicator      | Can only be the first field. Indicates that CCI is not used. For any other position 0x00 indicates end of CCI fields, the parser may stop. Should also be used before any kind of padding. |
| 0x01        |    var | Application Identifier | Unique identifier for the application.                                              |
| 0x02        |     32 | Next Cube Reference    | 32-byte key of the target cube.                                                     |
| 0x03        |    var | MUC/PMUC KDF hint/id   | Clients may store a value aiding in the re-calculation of the MUC/PMUC private key from a master key. (e.g. key derivation using BIP-44 or libsodium's crypto_kdf.) |
| 0x04 - 0x0F |    TBD | Reserved               | Reserved for future standard fields that might be defined as the CCI evolves.       |

**Next Cube Reference**: Contains the 32-byte key of the target cube. Facilitates the assembly of content spanning multiple cubes by concatenating the field prior to this field with the first field of the same type in the referenced cube. This may be chained multiple times for content of arbitrary length.

Standardized fields are defined to establish a universal foundation for payloads, ensuring a consistent and straightforward interpretation across different applications.

#### Common content-descriptive fields
| Type (hex)  | Field name             | Len | Description                                                                         |
|-------------|------------------------|-----|-------------------------------------------------------------------------------------|
| 0x10        | Payload                | var | Denotes the "main" or most relevant data, the raison d'être for this Cube.          |
| 0x11        | Content name           | var | Concise, plain text description of this Cube's Payload, e.g. "Chancellor on brink of second bailout for banks" or "Charpentier - Te Deum, Prelude.mp3" |
| 0x12        | Description            | var | A short summary of this Cube's Payload, e.g. a textual descriptionm of non-text content, a summary or an article's lead paragraph. Should be plain text with optional markdown. |
| 0x13        | Related to             |  33 | A single byte code denoting commonly used relationships this cube may have with other cubes, plus the key of the referred Cube |
| 0x14        | User name              | var | TODO move to two byte code
| 0x15        | Media type (short)     |   1 | Type of content in this Cube's Payload field. This short field contains a single byte code denoting commonly used media types and should be preferred whenever applicable. |
| 0x16        | User avatar            | var | Describes an auto-generated, guaranteed safe to show avatar for this user - TODO move to two byte code|
| 0x1C01      | Media type (long )     | var | The MIME type of the file, a standardized indication of the file format to be used for types not included in our short codes.  |
| 0x1F00      | Padding (variable)     | var | Applications chosing to encapsulate any padding into a TLV field should use this ID. |

### CCI media type short codes
tbd

### CCI Cube relationships
tbd

### CCI user identities
tbd

#### Safe to show avatars
The `User avatar` field describes an auto-generatable avatar which is guaranteed
to be safe to show. The field starts with a single byte avatar scheme code, with
all remaining bytes to be parsed as required by the avatar scheme.

\<Avatar scheme\>:\<scheme-specific description>

Defined schemes are (length includes scheme code):
| Code | Length | Name             | Description                                    | How to parse                  |
| 1    |      6 | multiavatar      | Auto-generated by the multiavatar lib          | Convert to hex string, then feed into lib |


### Custom Fields

Applications can define custom fields starting from `0x10` to `0x3F`, providing ample space to cater to various application-specific requirements. Custom fields allow applications to tailor the payload structure to suit their unique needs, adding a range of functionalities.

# Applications using CCI

# File Application

The file application is a specific implementation leveraging the Common Cube Interface (CCI) to facilitate the transmission and reception of files over the Verity network. It only supports PIC and PMUC cubes to prevent files from unexpectedly changing. This application defines a set of custom fields tailored to handle file attributes efficiently.

## Application Identifier

To uniquely identify the payload as belonging to the file application, we define the following application identifier:

- **Application Identifier**: `file`

## Custom Fields

To adequately represent file data and associated attributes within a payload, the file application defines the following custom fields:

| Type (Hex) | Field Name      | Description |
|------------|-----------------|-----------------------------------------------------------------------------------|
| 0x10       | File Content    | The actual data content of the file. (= CCI Payload)                              |
| 0x11       | Filename        | The name of the file, including the extension, to indicate the file type (= CCI Content Name) |
| 0x12       | MIME Type       | The MIME type of the file, offering a standardized indication of the file format. (suggest to use CCI media type instead) |
| 0x13       | Metadata        | Additional information about the file (file size, creation date, etc.) (suggest to use separate fields -- actually, we should incorporate certain commonly used metadata types like size and date into CCI)           |

### Usage

When transmitting a file, the application should at minimum populate the filename and file content fields to ensure the recipient has the necessary data to reconstruct the file. The inclusion of MIME Type and Metadata fields is encouraged to provide a richer set of information about the file, facilitating more nuanced handling and organization of files by the recipient application.

For files that exceed the payload capacity of a single cube, the application utilizes the "Next Cube Reference" field defined in the CCI to chain multiple cubes together, allowing for the seamless assembly of larger files.