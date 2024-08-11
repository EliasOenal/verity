import { CubeKey } from "../../../src/core/cube/cube.definitions";
import { writePersistentNotificationBlob, parsePersistentNotificationBlob } from "../../../src/core/cube/cubeUtil";
import { NetConstants } from "../../../src/core/networking/networkDefinitions";

describe('notification related', () => {
  describe('writePersistentNotificationBlob()', () => {
    it('should write a persistent notification blob of five keys', async () => {
      const keys: CubeKey[] = [
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 1),
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 2),
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 3),
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 4),
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 5),
      ]
      const blob: Buffer = writePersistentNotificationBlob(keys);
      expect(blob).toBeDefined();
      expect(blob.length).toEqual(5 * NetConstants.CUBE_KEY_SIZE);
      for (let i = 0; i < keys.length; i++) {
        expect(blob.subarray(i * NetConstants.CUBE_KEY_SIZE, (i + 1) * NetConstants.CUBE_KEY_SIZE))
          .toEqual(keys[i]);
      }
    });

    it('should return a zero-length Buffer if no keys are supplied', async () => {
      const keys: CubeKey[] = [];
      const blob: Buffer = writePersistentNotificationBlob(keys);
      expect(blob).toBeDefined();
      expect(blob.length).toEqual(0);
    });
  });  // writePersistentNotificationBlob()

  describe('parsePersistentNotificationBlob()', () => {
    it('should parse a persistent notification blob correctly', async () => {
      const keys: CubeKey[] = [
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 1),
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 2),
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 3),
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 4),
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 5),
      ]
      const blob: Buffer = writePersistentNotificationBlob(keys);
      const parsedKeys: CubeKey[] = [];
      for await (const key of parsePersistentNotificationBlob(blob)) {
        parsedKeys.push(key);
      }
      expect(parsedKeys).toHaveLength(5);
      for (let i = 0; i < keys.length; i++) {
        expect(parsedKeys[i]).toEqual(keys[i]);
      }
    });

    it('should return an empty iterable if the blob is empty', async () => {
      const blob: Buffer = Buffer.alloc(0);
      const parsedKeys: CubeKey[] = [];
      for await (const key of parsePersistentNotificationBlob(blob)) {
        parsedKeys.push(key);
      }
      expect(parsedKeys).toHaveLength(0);
    });
  });  // parsePersistentNotificationBlob()
});  // CubeUtil functions
