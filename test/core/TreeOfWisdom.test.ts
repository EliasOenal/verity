import { TreeOfWisdom } from "../../src/core/tow";
import { Buffer } from "buffer";

import * as crypto from "crypto";
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

// Helper function to generate a random 256-bit key in hexadecimal format
function generateRandomKey(): string {
  const bytes = crypto.randomBytes(32); // 32 bytes = 256 bits
  return bytes.toString("hex");
}

interface KeyValueOperation {
  key: string;
  value: Buffer;
}

describe("Tree of Wisdom Tests", () => {
  describe("Tree of Wisdom Basic Operations", () => {
    test("insertion order does not affect tree structure", () => {
      const tree1 = new TreeOfWisdom();
      const tree2 = new TreeOfWisdom();

      tree1.set("A", Buffer.from("alpha"));
      tree1.set("B", Buffer.from("beta"));
      tree2.set("B", Buffer.from("beta"));
      tree2.set("A", Buffer.from("alpha"));

      expect(tree1.getRootHash()).toEqual(tree2.getRootHash());
    });

    test("insert and retrieve values", () => {
      const tree = new TreeOfWisdom();
      tree.set("A", Buffer.from("alpha"));
      tree.set("B", Buffer.from("beta"));

      expect(tree.get("A")?.toString()).toEqual("alpha");
      expect(tree.get("B")?.toString()).toEqual("beta");
    });

    test("delete key-value pairs", () => {
      const tree = new TreeOfWisdom();
      tree.set("C0FFEE", Buffer.from("coffee"));
      tree.delete("C0FFEE");

      expect(tree.get("A")).toBeNull();
    });

    test("handling of large data sets", () => {
      const tree = new TreeOfWisdom();
      const totalKeys = 10000;
      for (let i = 0; i < totalKeys; i++) {
        const key = crypto.randomBytes(20).toString("hex");
        const value = Buffer.from(`value${i}`);
        tree.set(key, value);
      }
      // Perform some checks on the tree's integrity and performance metrics
      expect(tree.getTreeStatistics().totalKeys).toEqual(totalKeys);
    });

    test("re-inserting a deleted key updates the tree correctly", () => {
      const tree = new TreeOfWisdom();
      tree.set("FA57C0DE", Buffer.from("alpha"));
      tree.delete("FA57C0DE");
      tree.set("FA57C0DE", Buffer.from("beta"));
      expect(tree.get("FA57C0DE")?.toString()).toEqual("beta");
    });

    test("updating an existing key's value and verifying tree structure", () => {
      const tree = new TreeOfWisdom();
      tree.set("A", Buffer.from("alpha"));
      const initialRootHash = tree.getRootHash();
      tree.set("A", Buffer.from("updatedAlpha"));
      const updatedRootHash = tree.getRootHash();
      expect(tree.get("A")?.toString()).toEqual("updatedAlpha");
      expect(initialRootHash).not.toEqual(updatedRootHash);
    });

    test("retrieving a non-existent key returns null", () => {
      const tree = new TreeOfWisdom();
      tree.set("DABBAD00", Buffer.from("alpha"));
      expect(tree.get("BADC0DE")).toBeNull();
    });

    test("inserting duplicate keys updates value", () => {
      const tree = new TreeOfWisdom();
      tree.set("A", Buffer.from("alpha"));
      tree.set("A", Buffer.from("omega")); // Duplicate key

      expect(tree.get("A")?.toString()).toEqual("omega");
    });
  });

  describe("Tree of Wisdom Integrity and Structure", () => {
    test("tree structure after complex operations", () => {
      const tree = new TreeOfWisdom();
      // Insert multiple values
      tree.set("111", Buffer.from("value1"));
      tree.set("112", Buffer.from("value2"));
      // Delete a key
      tree.delete("111");
      // Insert more values
      tree.set("113", Buffer.from("value3"));

      // Expected hash should be set to what your implementation produces after these operations
      const expectedHashAfterOperations =
        "d3a9cb41f56892f93c488bc9cfc79aff8911ffbd827cfa3a0600919ae04893bc";
      expect(tree.getRootHash()).toEqual(expectedHashAfterOperations);
    });

    test("stress testing the tree with 1000 inserts and 50 random deletes", () => {
      const tree = new TreeOfWisdom();
      const totalInserts = 1000;
      const totalDeletes = 50;
      const keys = new Set<string>();
      const deletedKeys = new Set<string>();
      const keyValueMap = new Map<string, Buffer>();

      // Generate and insert {totalInserts} unique keys with random values
      for (let i = 0; i < totalInserts; i++) {
        const key = (i + 1337).toString(16); // Ensure hex string format
        const value = Buffer.from((31337 * i).toString(16));
        tree.set(key, value);
        keys.add(key);
        keyValueMap.set(key, value);
      }

      // Shuffle the array of keys and then delete {totalDeletes} keys from the tree
      const keysArray = Array.from(keys);
      shuffleArray(keysArray); // Shuffle the keys array
      for (let i = 0; i < totalDeletes; i++) {
        const keyToDelete = keysArray[i]; // Take the key from the shuffled array
        tree.delete(keyToDelete);
        keys.delete(keyToDelete);
        deletedKeys.add(keyToDelete);
        keyValueMap.delete(keyToDelete);
      }

      // Verify that deleted keys cannot be retrieved
      deletedKeys.forEach((key) => {
        const retrievedValue = tree.get(key);
        expect(retrievedValue).toBeNull();
      });

      // Verify that non-deleted keys can still be retrieved correctly
      keys.forEach((key) => {
        const expectedValue = keyValueMap.get(key);
        const retrievedValue = tree.get(key);
        expect(retrievedValue).not.toBeNull();
        expect(retrievedValue).toEqual(expectedValue);
      });
    });
  });

  // Helper function to shuffle an array in place
  function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]]; // Swap elements
    }
  }

  describe("Tree of Wisdom Performance and Stress Testing", () => {
    test("two trees with >20,000 operations applied in different orders have the same root hash", () => {
      const tree1 = new TreeOfWisdom();
      const tree2 = new TreeOfWisdom();
      const insertOperations: Array<{ key: string; value: Buffer }> = [];
      const deleteKeys: string[] = [];
      const additionalInsertOperations: Array<{ key: string; value: Buffer }> =
        [];

      // Prepare initial insert operations with randomized keys
      for (let i = 0; i < 20000; i++) {
        const key = generateRandomKey();
        const value = Buffer.from(Math.random().toString(36).substring(2, 15));
        insertOperations.push({ key, value });
      }

      // Select a subset of keys for deletion from the initial insertions
      const keysToBeDeleted = insertOperations
        .map((op) => op.key)
        .sort(() => 0.5 - Math.random())
        .slice(0, 1337);

      // Prepare additional insert operations
      for (let i = 0; i < 1500; i++) {
        const key = generateRandomKey();
        const value = Buffer.from(Math.random().toString(36).substring(2, 15));
        additionalInsertOperations.push({ key, value });
      }

      // Insert initial elements into tree1 in shuffled order
      insertOperations
        .sort(() => 0.5 - Math.random())
        .forEach(({ key, value }) => {
          tree1.set(key, value);
        });
      // Insert initial elements into tree2 in shuffled order
      insertOperations
        .sort(() => 0.5 - Math.random())
        .forEach(({ key, value }) => {
          tree2.set(key, value);
        });

      // Randomize and apply deletions individually for tree1 and tree2
      keysToBeDeleted
        .sort(() => 0.5 - Math.random())
        .forEach((key) => tree1.delete(key));
      keysToBeDeleted
        .sort(() => 0.5 - Math.random())
        .forEach((key) => tree2.delete(key));

      // Insert additional elements into tree1 in shuffled order
      additionalInsertOperations
        .sort(() => 0.5 - Math.random())
        .forEach(({ key, value }) => {
          tree1.set(key, value);
        });
      // Insert additional elements into tree2 in shuffled order
      additionalInsertOperations
        .sort(() => 0.5 - Math.random())
        .forEach(({ key, value }) => {
          tree2.set(key, value);
        });

      // Compare the root hashes
      expect(tree1.getRootHash()).toEqual(tree2.getRootHash());
    });

    test("trees with deletions and selective insertions have matching root hashes", () => {
      const tree1 = new TreeOfWisdom();
      const tree2 = new TreeOfWisdom();

      const allOperations: KeyValueOperation[] = [];
      for (let i = 0; i < 12000; i++) {
        const key = generateRandomKey();
        const value = Buffer.from(i.toString());
        allOperations.push({ key, value });
      }

      // Pick random keys to delete
      const keysToDelete = allOperations
        .map((op) => op.key)
        .sort(() => 0.5 - Math.random())
        .slice(0, 7000);

      // Insert all key-value pairs into tree1
      allOperations.forEach(({ key, value }) => {
        tree1.set(key, value);
      });

      // Delete the keys selected for deletion from tree1
      keysToDelete.forEach((key) => {
        tree1.delete(key);
      });

      // Insert the remaining key-value pairs into tree2
      allOperations
        .filter((op) => !keysToDelete.includes(op.key))
        .forEach(({ key, value }) => {
          tree2.set(key, value);
        });

      // Compare the root hashes of both trees
      expect(tree1.getRootHash()).toEqual(tree2.getRootHash());
    });

    test("deleting all keys returns the tree to an empty root", () => {
      const tree = new TreeOfWisdom();
      const keysValues = [
        { key: "a1b2", value: Buffer.from("value1") },
        { key: "b1c2", value: Buffer.from("value2") },
        { key: "c1d2", value: Buffer.from("value3") },
        { key: "d1e2", value: Buffer.from("value4") },
        { key: "e1f2", value: Buffer.from("value5") },
      ];

      // Insert keys into the tree
      keysValues.forEach(({ key, value }) => {
        tree.set(key, value);
      });

      // Delete all inserted keys
      keysValues.forEach(({ key }) => {
        tree.delete(key);
      });

      // Compute the expected empty root hash
      const expectedEmptyRootHash =
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

      // Verify the tree's root hash matches the expected empty root hash
      expect(tree.getRootHash()).toEqual(expectedEmptyRootHash);
    });
  });

  describe("Tree of Wisdom Drop Subtree Tests", () => {
    test("dropping a subtree with a single matching prefix", () => {
      const tree = new TreeOfWisdom();
      tree.set("AB", Buffer.from("value1"));
      tree.set("AC", Buffer.from("value2"));
      tree.set("AD", Buffer.from("value3"));
      tree.dropSubtree("A");

      expect(tree.get("AB")).toBeNull();
      expect(tree.get("AC")).toBeNull();
      expect(tree.get("AD")).toBeNull();
      expect(tree.getTreeStatistics().totalKeys).toEqual(0);
    });

    test("dropping a subtree does not affect unrelated keys", () => {
      const tree = new TreeOfWisdom();
      tree.set("AB", Buffer.from("value1"));
      tree.set("AC", Buffer.from("value2"));
      tree.set("FF", Buffer.from("value3"));
      tree.dropSubtree("A");

      expect(tree.get("AB")).toBeNull();
      expect(tree.get("AC")).toBeNull();
      expect(tree.get("FF")?.toString()).toEqual("value3");
      expect(tree.getTreeStatistics().totalKeys).toEqual(1);
    });

    test("dropping the entire tree by providing an empty prefix", () => {
      const tree = new TreeOfWisdom();
      tree.set("AB", Buffer.from("value1"));
      tree.set("FF", Buffer.from("value2"));
      tree.dropSubtree("");

      expect(tree.getRootHash()).toEqual(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
      ); // Expected hash for an empty tree
    });

    test("dropping a subtree with a non-existent prefix leaves the tree unchanged", () => {
      const tree = new TreeOfWisdom();
      tree.set("AB", Buffer.from("value1"));
      tree.set("AC", Buffer.from("value2"));
      const initialRootHash = tree.getRootHash();

      tree.dropSubtree("B");
      const finalRootHash = tree.getRootHash();

      expect(initialRootHash).toEqual(finalRootHash);
      expect(tree.getTreeStatistics().totalKeys).toEqual(2);
    });

    test("dropping a subtree that is a leaf node", () => {
      const tree = new TreeOfWisdom();
      tree.set("AB", Buffer.from("value1"));
      tree.set("FF", Buffer.from("value2"));
      tree.dropSubtree("AB");

      expect(tree.get("AB")).toBeNull();
      expect(tree.get("FF")?.toString()).toEqual("value2");
      expect(tree.getTreeStatistics().totalKeys).toEqual(1);
    });

    test("complex operation: insert, drop subtree, then verify remaining structure", () => {
      const tree = new TreeOfWisdom();
      // Insert multiple values forming two distinct subtrees
      tree.set("1AB1", Buffer.from("value1"));
      tree.set("1AB2", Buffer.from("value2"));
      tree.set("1DE1", Buffer.from("value3"));
      tree.set("1DE2", Buffer.from("value4"));

      // Drop one of the subtrees
      tree.dropSubtree("1AB");

      // Verify that all keys in the dropped subtree are removed
      expect(tree.get("1AB1")).toBeNull();
      expect(tree.get("1AB2")).toBeNull();

      // Verify that keys in the other subtree are unaffected
      expect(tree.get("1DE1")?.toString()).toEqual("value3");
      expect(tree.get("1DE2")?.toString()).toEqual("value4");
      expect(tree.getTreeStatistics().totalKeys).toEqual(2);
    });
  });

  describe("TreeOfWisdom traverseOneLevel Method Tests", () => {
    let tree;

    beforeEach(() => {
      tree = new TreeOfWisdom();
    });

    test("traversing from a branch node returns immediate children", () => {
      // Setup a scenario where the root is a branch node with children
      let valueBuffers = [
        Buffer.from("alpha"),
        Buffer.from("beta"),
        Buffer.from("gamma"),
      ];
      // Insert keys and values into the tree
      tree.set("AA", valueBuffers[0]);
      tree.set("BB", valueBuffers[1]);
      tree.set("CC", valueBuffers[2]);

      // Traverse one level from the root
      const children = tree.traverseOneLevel(tree.getRoot());

      // Assert that the immediate children are returned
      expect(children.length).toBeGreaterThanOrEqual(2); // Actual number might vary based on implementation
      // Iterate children and verify their values
      children.forEach((child) => {
        expect(child.value).toEqual(valueBuffers.shift());
      });
    });

    test("extension child node resolves to the branch or leaf it points to", () => {
      // Setup a scenario where an extension node leads to a branch node
      tree.set("A", Buffer.from("alpha"));
      tree.set("B", Buffer.from("beta"));
      tree.set("AAA", Buffer.from("gamma"));
      tree.set("AAAAA", Buffer.from("delta"));

      const rootNode = tree.getRoot();
      expect(rootNode.getType()).toEqual("branch");

      let result = tree.traverseOneLevel(rootNode);
      expect(result[0].getType()).toEqual("branch");

      result = tree.traverseOneLevel(result[0]);
      expect(result[0].getType()).toEqual("leaf");
    });

    test("deep traversal accurately handles nested structures", () => {
      // Setup a deeper tree structure
      tree.set("A1B2", Buffer.from("value1"));
      tree.set("A1B2C3", Buffer.from("value2"));
      tree.set("A1B2C3D4", Buffer.from("value3"));

      const branchNode = tree.root;

      // Traverse one level from a deeper branch node
      const children = tree.traverseOneLevel(branchNode);

      // Assert the children are correctly returned from the deeper node
      // Expectation will depend on the tree's structure and the method's behavior
      expect(children.length).toBeGreaterThanOrEqual(1); // Adjust based on expected outcome
    });

    test("traverseOneLevel should not traverse null nodes", () => {
      // Traverse one level from a null input
      try {
        const children = tree.traverseOneLevel(null);
        // Fail the test if the method does not throw an error
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
  });

  describe("getNode Method Tests", () => {
    let tree;

    beforeEach(() => {
      tree = new TreeOfWisdom();
    });

    test("retrieve a leaf node by exact match key", () => {
      tree.set("A1B2", Buffer.from("leafValue"));
      const node = tree.getNode("A1B2");
      expect(node).not.toBeNull();
      expect(node.getType()).toEqual("leaf");
      expect(node.getValue().toString()).toEqual("leafValue");
    });

    test("retrieve an extension node by matching path", () => {
      tree.set("A1B2C3", Buffer.from("value"));
      tree.set("A1B2C4FFFFFF", Buffer.from("anotherValue"));
      tree.set("A1B2C4FFFFFE", Buffer.from("yetAnotherValue"));
      let node = tree.getNode("");
      expect(node).not.toBeNull();
      expect(node.getType()).toEqual("extension");

      node = tree.getNode("A1B2C4");
      expect(node).not.toBeNull();
      expect(node.getType()).toEqual("extension");
    });

    test("retrieve a branch node", () => {
      tree.set("A1B2C3", Buffer.from("value"));
      tree.set("A1B2C4", Buffer.from("anotherValue"));
      const node = tree.getNode("A1B2C");
      expect(node).not.toBeNull();
      expect(node.getType()).toEqual("branch");
    });

    test("return null for non-existent key", () => {
      tree.set("A1B2", Buffer.from("value"));
      const node = tree.getNode("BCD");
      expect(node).toBeNull();
    });

    test("partial match with extension node returns null", () => {
      tree.set("A1B2C3D4", Buffer.from("value"));
      tree.set("A1B2C3D5", Buffer.from("anotherValue"));
      const node = tree.getNode("A1B2C");
      expect(node).toBeNull();
    });

    test("key longer than any path returns null", () => {
      tree.set("A1B2", Buffer.from("value"));
      const node = tree.getNode("A1B2C3D4E5");
      expect(node).toBeNull();
    });
  });
});
