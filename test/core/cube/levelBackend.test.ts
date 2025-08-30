import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { LevelBackend, Sublevels } from '../../../src/core/cube/levelBackend';
import { evenLonger, farTooLong, tooLong } from '../../cci/testcci.definitions';

describe('LevelBackend', () => {
  let l: LevelBackend;

  const key1 = Buffer.from('1234567890', 'hex');
  const val1 = Buffer.from(tooLong);

  const key2 = Buffer.from('aabbccddee', 'hex');
  const val2 = Buffer.from(farTooLong);

  const key3 = Buffer.from('ff00ff00ff', 'hex');
  const val3 = Buffer.from(evenLonger);

  beforeAll(async () => {
    l = new LevelBackend({
      dbName: 'unittests',
      dbVersion: 1,
      inMemoryLevelDB: true,
    });
    await l.ready;

    await l.store(Sublevels.BASE_DB, key1, val1);
    await l.store(Sublevels.BASE_DB, key2, val2);
    await l.store(Sublevels.BASE_DB, key3, val3);
  });

  it.todo('LevelBackend has almost no unit tests. Write a proper set of unit tests.');

  describe('autocompletePartialKey()', () => {
    it('should return a full key', async () => {
      // note to adhere to the byte boundaries when converting from hex
      expect(await l.autocompletePartialKey(Buffer.from("1234", 'hex'), Sublevels.BASE_DB)).toEqual(key1);
      expect(await l.autocompletePartialKey(Buffer.from("3456", 'hex'), Sublevels.BASE_DB)).toEqual(key1);
      expect(await l.autocompletePartialKey(Buffer.from("90", 'hex'), Sublevels.BASE_DB)).toEqual(key1);
      expect(await l.autocompletePartialKey(Buffer.from("34", 'hex'), Sublevels.BASE_DB)).toEqual(key1);
      expect(await l.autocompletePartialKey(Buffer.from("1234567890", 'hex'), Sublevels.BASE_DB)).toEqual(key1);
      expect(await l.autocompletePartialKey(key1, Sublevels.BASE_DB)).toEqual(key1);

      expect(await l.autocompletePartialKey(Buffer.from("aa", 'hex'), Sublevels.BASE_DB)).toEqual(key2);
      expect(await l.autocompletePartialKey(Buffer.from("bb", 'hex'), Sublevels.BASE_DB)).toEqual(key2);
      expect(await l.autocompletePartialKey(Buffer.from("cc", 'hex'), Sublevels.BASE_DB)).toEqual(key2);
      expect(await l.autocompletePartialKey(Buffer.from("dd", 'hex'), Sublevels.BASE_DB)).toEqual(key2);
      expect(await l.autocompletePartialKey(Buffer.from("ee", 'hex'), Sublevels.BASE_DB)).toEqual(key2);
      expect(await l.autocompletePartialKey(Buffer.from("bbcc", 'hex'), Sublevels.BASE_DB)).toEqual(key2);
      expect(await l.autocompletePartialKey(Buffer.from("aabb", 'hex'), Sublevels.BASE_DB)).toEqual(key2);
      expect(await l.autocompletePartialKey(Buffer.from("ccddee", 'hex'), Sublevels.BASE_DB)).toEqual(key2);
      expect(await l.autocompletePartialKey(key2, Sublevels.BASE_DB)).toEqual(key2);

      expect(await l.autocompletePartialKey(Buffer.from("ff", 'hex'), Sublevels.BASE_DB)).toEqual(key3);
      expect(await l.autocompletePartialKey(Buffer.from("00", 'hex'), Sublevels.BASE_DB)).toEqual(key3);
      expect(await l.autocompletePartialKey(Buffer.from("ff00", 'hex'), Sublevels.BASE_DB)).toEqual(key3);
      expect(await l.autocompletePartialKey(Buffer.from("00ff", 'hex'), Sublevels.BASE_DB)).toEqual(key3);
      expect(await l.autocompletePartialKey(key3, Sublevels.BASE_DB)).toEqual(key3);
    });
  });
});