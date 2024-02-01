# Introduction

Verity operates as the core of a decentralized system, functioning as the foundational storage layer leveraging unique data structures known as "cubes." Each cube encapsulates 1kB of payload data, serving as the fundamental unit of information exchange synchronized across participating nodes in the Verity network.

To streamline the interaction between various applications and these cubes, the Common Cube Interface (CCI) was developed. It provides a standardized format for the payload data within a cube, enabling a structured and consistent approach to data representation. This standardization fosters interoperability among different applications, facilitating a smoother and more coherent data transmission landscape in the Verity network.

# Common Cube Interface (CCI)

The Common Cube Interface (CCI) is a standardized payload format designed to facilitate interoperability between different applications built on the Verity network. By adhering to a common set of rules for structuring the payload data within a cube, applications can more easily share and understand the data being transmitted.

## Overview

CCI delineates a specific range of type numbers for standardized fields and reserves a separate range for custom fields defined by individual applications. This ensures a harmonized approach to handling payload data while allowing applications the flexibility to introduce their custom fields based on specific requirements.

### Common Cube Interface (CCI) Field Specifications

Proposed repartition of type space:
0x00 - 0x0B: Common technical fields, "Core CCI", 0x00 being a CCI-friendly field to opt out of CCI
0x0C - 0x0F: Less common technical fields (multi-byte fields like 0x0C42)
0x10 - 0x1B: Common content-descriptive fields, can be opted-out of by applications which don't use them by declaring a 0x10 field
0x1C - 0x1F: Less common content-descriptive fields (multi-byte fields like 0x1C42)
0x10 - 0x3F: Application-specific

| Type (Hex)  | Field Name             | Len | Description                                                                         | Implementation/note |
|-------------|------------------------|-----|-------------------------------------------------------------------------------------|---------------------|
| 0x00        | Non-CCI Indicator      |   0 | Can only be the first field. Indicates that CCI is not used.                        |                     |
| 0x01        | Application ID         |   2 | 16-bit identifier for the general type of application. (encourages cross-application compatibility) |                     |
| 0x02        | Continued in           |  33 | References a field and another Cube in which this specific field is continued in    |                     |
| 0x03        | MUC sub-key seed       | var | Seed used to derive a new key pair for an extension MUC                             |                     |
| 0x04        | Media type (short)     |   1 | A single byte code denoting commonly used media types                               |                     |
| 0x0A        | Padding (variable)     | var | Variable length padding field, to be ignored                                        | move to extension header maybe? |
| 0x0B        | Padding (single Byte)  |   1 | Variable length padding field, to be ignored                                        |                     |
| 0x07-0x0B   | Reserved               |     |                                                                                     |                     |
| 0x0C02      | Application ID (long ) | var | A unique identifier for each application.                                           | Best to use UUID?   |
| 0x0C02      | Media type (long )     | var | The MIME type of the file, a standardized indication of the file format to be used for types not included in our short codes. |  |
| 0x10        | Content field opt-out  | var | Applications opting NOT to use the content-descriptive field block should define a variable length field with type ID 0x10 and declare it in every Cube | |
| 0x11        | Related to             |   1 | A single byte code denoting commonly used relationships this cube may have with other cubes. |            |
| 0x12        | User name              | var |
| 0x0F        | Payload                | var | Denotes the "main" or most relevant data, the raison d'être for this Cube.          |                     |
| 0x10 - 0x3F | Custom Fields          |     | Defined by individual applications to store application-specific data and metadata. |                     |

**Next Cube Reference**: Contains the 32-byte key of the target cube. Facilitates the assembly of content spanning multiple cubes by concatenating the field prior to this field with the first field of the same type in the referenced cube. This may be chained multiple times for content of arbitrary length.

Standardized fields are defined to establish a universal foundation for payloads, ensuring a consistent and straightforward interpretation across different applications.

### CCI media types
tbd

### CCI Cube relationships
tbd

### CCI user identities
tbd

#### Private key recovery
tbd (password-encrypted privkey inserted as Cube to allow identities to be reused across devices, i.e. to provide the well-known "login" experience for Verity apps)

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
| 0x10       | Filename        | The name of the file, including the extension, to indicate the file type.         |
| 0x11       | File Content    | The actual data content of the file. (suggest to use Payload instead)             |
| 0x12       | MIME Type       | The MIME type of the file, offering a standardized indication of the file format. (suggest to use CCI media type instead) |
| 0x13       | Metadata        | Additional information about the file (file size, creation date, etc.) (suggest to use separate fields -- actually, we should incorporate certain commonly used metadata types like size and date into CCI)           |

### Usage

When transmitting a file, the application should at minimum populate the filename and file content fields to ensure the recipient has the necessary data to reconstruct the file. The inclusion of MIME Type and Metadata fields is encouraged to provide a richer set of information about the file, facilitating more nuanced handling and organization of files by the recipient application.

For files that exceed the payload capacity of a single cube, the application utilizes the "Next Cube Reference" field defined in the CCI to chain multiple cubes together, allowing for the seamless assembly of larger files.