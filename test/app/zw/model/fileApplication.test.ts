import { CubeKey } from '../../../../src/core/cube/cube.definitions';

import { FieldType } from '../../../../src/cci/cube/cciCube.definitions';
import { cciCube } from '../../../../src/cci/cube/cciCube';
import { VerityField } from '../../../../src/cci/cube/verityField';
import { RelationshipType } from '../../../../src/cci/cube/relationship';

import { FileApplication } from '../../../../src/app/fileApplication';

import { Buffer } from 'buffer';
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { CubeStore } from '../../../../src/core/cube/cubeStore';
import { testCubeStoreParams } from '../../../cci/testcci.definitions';

describe('FileApplication', () => {
  test('createFileCubes with small string', async () => {
    const content = 'Hello File!';
    const fileName = 'test.txt';
    const cubes = await FileApplication.createFileCubes(Buffer.from(content), fileName);

    expect(cubes.length).toBe(1);
    const cube = cubes[0];
    expect(cube).toBeInstanceOf(cciCube);

    const applicationField = cube.getFields(FieldType.APPLICATION)[0];
    expect(applicationField.valueString).toBe('file');

    const contentNameField = cube.getFields(FieldType.CONTENTNAME)[0];
    expect(contentNameField.valueString).toBe(fileName);

    const payloadField = cube.getFields(FieldType.PAYLOAD)[0];
    expect(payloadField.valueString).toBe(content);

    const dateField = cube.getFields(FieldType.DATE)[0];
    expect(dateField).toBeDefined();
  });

  test('createFileCubes with 2kb content', async () => {
    const content = Buffer.alloc(2048).fill('A');
    const fileName = 'large_file.txt';
    const cubes = await FileApplication.createFileCubes(content, fileName);

    expect(cubes.length).toBeGreaterThan(1);

    cubes.forEach((cube, index) => {
      expect(cube).toBeInstanceOf(cciCube);

      const applicationField = cube.getFields(FieldType.APPLICATION)[0];
      expect(applicationField.valueString).toBe('file');

      const contentNameField = cube.getFields(FieldType.CONTENTNAME)[0];
      expect(contentNameField.valueString).toBe(fileName);

      const payloadField = cube.getFields(FieldType.PAYLOAD)[0];
      expect(payloadField.value.length).toBeGreaterThan(0);

      const dateField = cube.getFields(FieldType.DATE)[0];
      expect(dateField).toBeDefined();

      if (index < cubes.length - 1) {
        const continuationRel = cube.fields.getFirstRelationship(RelationshipType.CONTINUED_IN);
        expect(continuationRel).toBeDefined();
      } else {
        const continuationRel = cube.fields.getFirstRelationship(RelationshipType.CONTINUED_IN);
        expect(continuationRel).toBeUndefined();
      }
    });

    // Check if the total payload size matches the original content size
    const totalPayloadSize = cubes.reduce((sum, cube) => {
      const payloadField = cube.getFields(FieldType.PAYLOAD)[0];
      return sum + payloadField.value.length;
    }, 0);
    expect(totalPayloadSize).toBe(content.length);
  });

  describe('retrieveFile', () => {
    test('retrieveFile with single cube', async () => {
      const content = 'Hello File!';
      const fileName = 'test.txt';
      const cubes = await FileApplication.createFileCubes(Buffer.from(content), fileName);

      const cubeStore = new CubeStore(testCubeStoreParams);
      await cubeStore.readyPromise;
      await cubeStore.addCube(cubes[0]);

      const result = await FileApplication.retrieveFile(await cubes[0].getKey(), cubeStore);

      expect(result.fileName).toBe(fileName);
      expect(result.content.toString()).toBe(content);
    });

    test('retrieveFile with non-existent cube', async () => {
      const cubeStore = new CubeStore(testCubeStoreParams);
      await cubeStore.readyPromise;

      await expect(FileApplication.retrieveFile(Buffer.alloc(32) as CubeKey, cubeStore))
        .rejects.toThrow('Cube not found');
    });

    test('retrieveFile with non-file application cube', async () => {
      const invalidCube = cciCube.Frozen({
        fields: VerityField.Application('not-file')
      });

      const cubeStore = new CubeStore(testCubeStoreParams);
      await cubeStore.readyPromise;
      await cubeStore.addCube(invalidCube);

      try {
        await FileApplication.retrieveFile(await invalidCube.getKey(), cubeStore);
        throw new Error('Expected FileApplication.retrieveFile to throw an error');
      } catch (error) {
        if (error instanceof Error) {
          expect(error.message).toBe('Not a file application cube');
        } else {
          throw new Error('Unexpected error type');
        }
      }
    });
  });
});
