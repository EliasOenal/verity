# Introduction

Verity operates as the core of a decentralized system, functioning as the foundational storage layer leveraging unique data structures known as "cubes." Each cube encapsulates 1kB of payload data, serving as the fundamental unit of information exchange synchronized across participating nodes in the Verity network.

To streamline the interaction between various applications and these cubes, the Common Cube Interface (CCI) was developed. It provides a standardized format for the payload data within a cube, enabling a structured and consistent approach to data representation. This standardization fosters interoperability among different applications, facilitating a smoother and more coherent data transmission landscape in the Verity network.

# Common Cube Interface (CCI)

The Common Cube Interface (CCI) is a standardized payload format designed to facilitate interoperability between different applications built on the Verity network. By adhering to a common set of rules for structuring the payload data within a cube, applications can more easily share and understand the data being transmitted.

## Overview

CCI delineates a specific range of type numbers for standardized fields and reserves a separate range for custom fields defined by individual applications. This ensures a harmonized approach to handling payload data while allowing applications the flexibility to introduce their custom fields based on specific requirements.

### Common Cube Interface (CCI) Field Specifications

| Type (Hex)  | Field Name             | Description |
|-------------|------------------------|-------------------------------------------------------------------------------------|
| 0x00        | Non-CCI Indicator      | Can only be the first field. Indicates that CCI is not used.                        |
| 0x01        | Application Identifier | Unique identifier for the application.                                              |
| 0x02        | Next Cube Reference    | 32-byte key of the target cube.                                                     |
| 0x03 - 0x0F | Reserved               | Reserved for future standard fields that might be defined as the CCI evolves.       |
| 0x10 - 0x3F | Custom Fields          | Defined by individual applications to store application-specific data and metadata. |

**Next Cube Reference**: Contains the 32-byte key of the target cube. Facilitates the assembly of content spanning multiple cubes by concatenating the field prior to this field with the first field of the same type in the referenced cube. This may be chained multiple times for content of arbitrary length.

Standardized fields are defined to establish a universal foundation for payloads, ensuring a consistent and straightforward interpretation across different applications. 

### Custom Fields

Applications can define custom fields starting from `0x10` to `0x3F`, providing ample space to cater to various application-specific requirements. Custom fields allow applications to tailor the payload structure to suit their unique needs, adding a range of functionalities.

# Applications using CCI

# File Application

The file application is a specific implementation leveraging the Common Cube Interface (CCI) to facilitate the transmission and reception of files over the Verity network. This application defines a set of custom fields tailored to handle file attributes efficiently.

## Application Identifier

To uniquely identify the payload as belonging to the file application, we define the following application identifier:

- **Application Identifier**: `file`

## Custom Fields

To adequately represent file data and associated attributes within a payload, the file application defines the following custom fields:

| Type (Hex) | Field Name      | Description |
|------------|-----------------|-----------------------------------------------------------------------------------|
| 0x10       | Filename        | The name of the file, including the extension, to indicate the file type.         |
| 0x11       | File Content    | The actual data content of the file.                                              |
| 0x12       | MIME Type       | The MIME type of the file, offering a standardized indication of the file format. |
| 0x13       | Metadata        | Additional information about the file (file size, creation date, etc.)            |

### Usage

When transmitting a file, the application should at minimum populate the filename and file content fields to ensure the recipient has the necessary data to reconstruct the file. The inclusion of MIME Type and Metadata fields is encouraged to provide a richer set of information about the file, facilitating more nuanced handling and organization of files by the recipient application.

For files that exceed the payload capacity of a single cube, the application utilizes the "Next Cube Reference" field defined in the CCI to chain multiple cubes together, allowing for the seamless assembly of larger files.