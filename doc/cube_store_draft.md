# Verity Binary Cube Store Specification
**DRAFT - NOT YET IMPLEMENTED**

## Header Structure
The file header is 1024 bytes long and consists of the following fields, with examples provided for each:

| Field                   | Size | Description                               | Example                                 |
|-------------------------|------|-------------------------------------------|-----------------------------------------|
| Magic Number            |    8 | A unique identifier for Verity files. Uses ASCII representation of "VERITY1". | "VERITY1" (`56 45 52 49 54 59 31 00` in hexadecimal) |
| Version                 |    4 | The version number of the file format. A 32-bit integer for version control. | `0` (Initial version) |
| Creation Timestamp      |    8 | The Unix timestamp for file creation. A 64-bit integer for dates beyond 2038. | `1610000000` (Example Unix timestamp) |
| Number of Cubes         |    8 | The total number of cube entries in the file. A 64-bit integer for metadata operations. | `100000` (Example number of cubes) |
| Reserved for Future Use |  996 | Space reserved for future metadata, security features, or other data. | Filled with zeros or placeholders |

Following the specification of the file header, the next section of the markdown documentation details the structure and storage of Cubes in their binary form, including their metadata.

## Entry Structure
After the 1024-byte file header, the file contains a sequence of Cube entries. Each entry encapsulates a Cube along with its metadata, stored in a binary format.
Each Cube entry within the file follows this structure:

| Field              | Size | Description                                      | Example                               |
|--------------------|------|--------------------------------------------------|---------------------------------------|
| Cube Key           |   32 | Unique identifier for the Cube.                  | `ABCD...` (32 bytes in hexadecimal)   |
| Cube Type          |    1 | Identifies the type of Cube (regular, MUC, IPC). | `0x00` (Regular Cube)                 |
| Challenge Level    |    1 | The challenge level for the Cube.                | `0x05` (Example challenge level)      |
| Timestamp          |    5 | The creation timestamp of the Cube.              | `5F5E1000` (Example in hexadecimal)   |
| PMUC Update Count  |    4 | Number of updates for a PMUC Cube. Non-PMUC cubes use `00000000` indicating not applicable. | `00000000` (non-PMUC) |
| Cube Data          | 1024 | The actual data payload of the Cube.             | (Binary data)                         |

## Cube Storage

- After the file header, Cube entries are stored sequentially without any separator or padding between them. Each entry's start is determined by the cumulative size of all preceding entries plus the file header size.
- The Cube Data field is fixed at 1024 bytes for all entries, ensuring a consistent and straightforward calculation of any entry's offset within the file.
- The structure allows for direct access to any Cube's metadata and data by calculating its offset from the beginning of the file, leveraging the indexing system described in the file header specification.

## File Capacity and Naming
- **Capacity**: Each file is designed to hold exactly 100,000 Cubes. The total file size is roughly 100 MB for each file.
- **Naming Convention**: Files are named using an incrementing number as more files are created to store new Cubes. This numbering follows a sequential pattern, facilitating easy identification and access. For example, the first file might be named `000001.cube`, the next `000002.cube`, and so on. This approach ensures a straightforward method for managing and accessing Cube files.
