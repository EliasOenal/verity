import { CubeStore } from '../../../src/core/cube/cubeStore';
import { ArrayFromAsync } from '../../../src/core/helpers/misc';

import { RetrievalFormat } from '../../../src/cci/veritum/veritum.definitions';
import { Identity } from '../../../src/cci/identity/identity';

import { testCciOptions } from '../testcci.definitions';

import sodium from 'libsodium-wrappers-sumo';
import { beforeAll, describe, expect, it } from 'vitest';

describe('Identity: getPosts generator; edge case tests', () => {
  let masterKey: Buffer;

  beforeAll(async () => {
    await sodium.ready;
    masterKey = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 42);
  })

  describe('invalid options for this Identity instance', () => {
    it('should return an empty Generator when this Identity has no Cube retrieval capabilities at all', async () => {
      const id = new Identity(undefined, masterKey, testCciOptions);

      const gen = id.getPosts();
      const posts = await ArrayFromAsync(gen);
      expect(posts).toHaveLength(0);
    });

    it('should return an empty Generator when requesting posts as Verita from an Instance which has no VeritumRetriever', async () => {
      const cubeStore = new CubeStore(testCciOptions);
      const id = new Identity(cubeStore, masterKey, testCciOptions);

      const gen = id.getPosts({ format: RetrievalFormat.Veritum });
      const posts = await ArrayFromAsync(gen);
      expect(posts).toHaveLength(0);
    });

    it('should return an empty Generator when requesting relationship resolution for an Instance which has no VeritumRetriever', async () => {
      const cubeStore = new CubeStore(testCciOptions);
      const id = new Identity(cubeStore, masterKey, testCciOptions);

      const gen = id.getPosts({ resolveRels: true });
      const posts = await ArrayFromAsync(gen);
      expect(posts).toHaveLength(0);
    });
  });
});
