import type { CubeRetrievalInterface } from "../core/cube/cubeRetrieval.definitions";
import type { CubeKey } from '../core/cube/coreCube.definitions';

import { CubeType } from '../core/cube/coreCube.definitions';

import { FieldType } from '../cci/cube/cube.definitions';
import { VerityField } from '../cci/cube/verityField';
import { Cube } from '../cci/cube/cube';
import { Relationship, RelationshipType } from '../cci/cube/relationship';

import { Buffer } from 'buffer';

export class FileApplication {
  private static readonly APPLICATION_IDENTIFIER = 'file';

  static async createFileCubes(fileContent: Buffer, fileName: string, progressCallback?: (progress: number, remainingSize: number) => void): Promise<Cube[]> {
    const cubes: Cube[] = [];
    let remainingSize = fileContent.length;
    const totalSize = fileContent.length;

    // Process the file content from end to beginning
    // Slice chunk size from the end of the file and add it to the payload field
    while (remainingSize > 0) {
      // Prepare Cube including boilerplate fields
      const cube = Cube.Frozen({ fields: [
        VerityField.Application(this.APPLICATION_IDENTIFIER),
        VerityField.ContentName(fileName)
      ]});

      // Chain Cubes if required
      if (cubes.length > 0) {
        const previousCubeKey = await cubes[0].getKey();
        cube.insertFieldBeforeBackPositionals(
          VerityField.RelatesTo(new Relationship(
            RelationshipType.CONTINUED_IN, previousCubeKey)));
      }

      // Add payload
      const chunkSize = Math.min(remainingSize,
        cube.fields.bytesRemaining() -
        cube.fieldParser.getFieldHeaderLength(FieldType.PAYLOAD));
      const startOffset = remainingSize - chunkSize;
      const chunk = fileContent.slice(startOffset, startOffset + chunkSize);
      cube.insertFieldBeforeBackPositionals(VerityField.Payload(chunk));

      cubes.unshift(cube); // Add to the beginning of the array
      remainingSize -= chunkSize;

      // Call progress callback if provided
      if (progressCallback) {
        const progress = ((totalSize - remainingSize) / totalSize) * 100;
        progressCallback(progress, remainingSize);
      }
    }

    return cubes;
  }

  static async retrieveFile(startCubeKey: CubeKey, cubeRetriever: CubeRetrievalInterface): Promise<{ content: Buffer, fileName: string}> {
    let currentCubeKey = startCubeKey;
    const chunks: Buffer[] = [];
    let fileName: string;

    while (currentCubeKey) {
      const cube = await cubeRetriever.getCube(currentCubeKey);

      if (!cube) {
        throw new Error('Cube not found');
      }

      if (cube.cubeType !== CubeType.FROZEN && cube.cubeType !== CubeType.PIC) {
        throw new Error('File application requires immutable cubes');
      }

      const cciCube = cube as Cube;

      const applicationFields = cciCube.fields.get(FieldType.APPLICATION);
      if (!applicationFields || !applicationFields.some(field => field.valueString === this.APPLICATION_IDENTIFIER)) {
        throw new Error('Not a file application cube');
      }

      const payloadFields = cciCube.fields.get(FieldType.PAYLOAD);
      if (payloadFields && payloadFields.length > 0) {
        chunks.push(payloadFields[0].value);
      }

      if (!fileName) {
        const fileNameFields = cciCube.fields.get(FieldType.CONTENTNAME);
        if (fileNameFields && fileNameFields.length > 0) {
          fileName = fileNameFields[0].valueString;
        }
      }

      const continuationRel = cciCube.fields.getFirstRelationship(RelationshipType.CONTINUED_IN);
      currentCubeKey = continuationRel ? continuationRel.remoteKey : null;
    }

    if (!fileName) {
      throw new Error('File name not found');
    }

    return {
      content: Buffer.concat(chunks),
      fileName
    };
  }
}
