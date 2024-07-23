import { Buffer } from 'buffer';
import { Cube } from '../core/cube/cube';
import { cciCube } from '../cci/cube/cciCube';
import { cciField, cciFieldType, MediaTypes } from '../cci/cube/cciField';
import { cciRelationship, cciRelationshipType } from '../cci/cube/cciRelationship';
import { cciFields, cciFrozenFieldDefinition } from '../cci/cube/cciFields';
import { CubeKey } from '../core/cube/cubeDefinitions';
import { Settings } from '../core/settings';

export class FileApplication {
  private static readonly APPLICATION_IDENTIFIER = 'file';
  private static readonly MAX_PAYLOAD_SIZE = 800; // Reserve some space for other fields
                                                  // TODO: Determine correct size

  static async createFileCubes(fileContent: Buffer, fileName: string): Promise<cciCube[]> {
    const cubes: cciCube[] = [];
    let remainingSize = fileContent.length;

    while (remainingSize > 0) {
      const chunkSize = Math.min(remainingSize, this.MAX_PAYLOAD_SIZE);
      const startOffset = fileContent.length - remainingSize;
      const chunk = fileContent.slice(startOffset, startOffset + chunkSize);
      const fields = new cciFields(undefined, cciFrozenFieldDefinition);

      // Add fields in the correct order
      fields.appendField(cciField.Application(this.APPLICATION_IDENTIFIER));
      fields.appendField(cciField.ContentName(fileName));
      fields.appendField(cciField.Payload(chunk));
      fields.appendField(cciField.Date());

      if (cubes.length > 0) {
        const nextCubeKey = await cubes[cubes.length - 1].getKey();
        fields.appendField(cciField.RelatesTo(new cciRelationship(cciRelationshipType.CONTINUED_IN, nextCubeKey)));
      }

      // Ensure CciEnd is the last field added
      fields.appendField(cciField.CciEnd());

      const cube = cciCube.Frozen({ fields });
      cubes.unshift(cube); // Add to the beginning of the array
      remainingSize -= chunkSize;
    }

    return cubes;
  }

  // TODO: test retrieval of multi cube files
  static async retrieveFile(startCubeKey: CubeKey, cubeStore: { getCube: (key: CubeKey) => Promise<Cube> }): Promise<{ content: Buffer, fileName: string}> {
    let currentCubeKey = startCubeKey;
    const chunks: Buffer[] = [];
    let fileName: string;

    while (currentCubeKey) {
      const cube = await cubeStore.getCube(currentCubeKey);
      
      if (!cube) {
        throw new Error('Cube not found');
      }

      const cciCube = cube as cciCube;
      
      const applicationFields = cciCube.fields.get(cciFieldType.APPLICATION);
      if (!applicationFields || !applicationFields.some(field => field.valueString === this.APPLICATION_IDENTIFIER)) {
        throw new Error('Not a file application cube');
      }

      const payloadFields = cciCube.fields.get(cciFieldType.PAYLOAD);
      if (payloadFields && payloadFields.length > 0) {
        chunks.push(payloadFields[0].value);
      }

      if (!fileName) {
        const fileNameFields = cciCube.fields.get(cciFieldType.CONTENTNAME);
        if (fileNameFields && fileNameFields.length > 0) {
          fileName = fileNameFields[0].valueString;
        }
      }

      const continuationRel = cciCube.fields.getFirstRelationship(cciRelationshipType.CONTINUED_IN);
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
