/* ********************************************************
 *
 * The Tree of Wisdom
 *
 * In the digital forest, wide and deep,
 * Where bytes and bits silently creep,
 * Lies a tree, not of wood, but of lore,
 * The Merkle Patricia, with secrets galore.
 *
 * No coin of gold beneath its shade,
 * But keys and values, deftly laid.
 * In branches high and roots so deep,
 * It guards the data that it keeps.
 *
 * In the realm of bytes, where secrets whisper soft,
 * Under the Merkle Patricia's boughs aloft.
 * A voyage through data, both ancient and new,
 * In a digital forest, where wisdom grows true.
 *
 * ********************************************************
 *
 * The Tree of Wisdom library introduces a data structure
 * inspired by the principles of Merkle Patricia Trees,
 * designed for the storage, retrieval, and management
 * of key-value pairs. It uses cryptographic
 * hashing for integrity verification, which further can be
 * leveraged for highly efficient network synchronization.
 *
 * ********************************************************
 *
 * Copyright (c) 2023 Elias Oenal <tow@eliasoenal.com>
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification, are permitted
 * provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions
 * and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions
 * and the following disclaimer in the documentation and/or other materials provided with the distribution.
 *
 * 3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse
 * or promote products derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS “AS IS” AND ANY EXPRESS OR
 * IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
 * FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER
 * IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT
 * OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

import * as crypto from "crypto";
import { Buffer } from "buffer";

export interface Node {
  getType(): string;
  getValue(): any;
  getHash(): string;
}

class BranchNode implements Node {
  private children: (Node | Buffer | null)[];
  private value: Buffer | null;
  private hash: string | null;
  public static BRANCH_NODE_CHILDREN = 16;

  constructor() {
    this.children = new Array(BranchNode.BRANCH_NODE_CHILDREN).fill(null);
    this.value = null;
    this.hash = null; // Hash is initially null and computed on demand
  }

  getChild(index: number): Node | Buffer | null {
    return this.children[index];
  }

  // get non-null children
  getChildren(): (Node | Buffer | null)[] {
    return this.children;
  }

  setChild(index: number, child: Node | Buffer | null): void {
    this.children[index] = child;
    this.hash = null; // Invalidate hash upon modification to ensure it's recalculated
  }

  getType(): string {
    return "branch";
  }

  setValue(value: Buffer | null): void {
    this.value = value;
    this.hash = null; // Invalidate hash upon modification
  }

  getValue(): Buffer | null {
    return this.value;
  }

  // Compute the hash on demand and cache it
  getHash(): string {
    if (!this.hash) {
      const hasher = crypto.createHash("sha256");
      hasher.update("0"); // Use a unique prefix for branch nodes
      for (const child of this.children) {
        // Handle both Node and Buffer types
        if (!child) {
          hasher.update("."); // Use '.' to represent null children in the hash.
        } else if (TreeOfWisdom.isNodeInstance(child)) {
          hasher.update(child.getHash()); // Recursively include the hash of child nodes.
        } else {
          hasher.update(child as Buffer); // Directly include the hash of embedded values.
        }
      }
      if (this.value !== null) {
        hasher.update(this.value); // Include the node's value in the hash if it exists.
      }
      this.hash = hasher.digest("hex");
    }
    return this.hash;
  }

  invalidateHash(): void {
    this.hash = null;
  }
}

class ExtensionNode implements Node {
  private segment: string;
  private child: Node;
  private hash: string | null;

  constructor(prefix: string, child: Node) {
    this.segment = prefix;
    this.child = child;
    this.hash = null;
  }

  getSegment(): string {
    return this.segment;
  }

  setSegment(newSegment: string): void {
    this.segment = newSegment;
    this.hash = null; // Invalidate hash upon modification
  }

  setChild(newChild: Node): void {
    this.child = newChild;
    this.hash = null; // Invalidate hash upon modification
  }

  getChild(): Node {
    return this.child;
  }

  getType(): string {
    return "extension";
  }

  getValue(): null {
    return null;
  }

  getHash(): string {
    if (!this.hash) {
      const hasher = crypto.createHash("sha256");
      hasher.update("1"); // Prefix for extension node
      hasher.update(this.segment);
      hasher.update(this.child.getHash());
      this.hash = hasher.digest("hex");
    }
    return this.hash;
  }

  invalidateHash(): void {
    this.hash = null;
  }
}

class LeafNode implements Node {
  private suffix: string; // The final suffix of the key since the path of the parent
  private value: Buffer;
  private hash: string | null;

  constructor(suffix: string, value: Buffer) {
    this.suffix = suffix;
    this.value = value;
    this.hash = null;
  }

  getSuffix(): string {
    return this.suffix;
  }

  setSuffix(newSuffix: string): void {
    this.suffix = newSuffix;
    this.hash = null; // Invalidate hash upon modification
  }

  getValue(): Buffer {
    return this.value;
  }

  setValue(newValue: Buffer): void {
    this.value = newValue;
    this.hash = null; // Invalidate hash upon modification
  }

  getType(): string {
    return "leaf";
  }

  // Compute the hash on demand and cache it
  getHash(): string {
    if (!this.hash) {
      const hasher = crypto.createHash("sha256");
      hasher.update("2"); // Use a unique prefix for leaf nodes
      hasher.update(this.suffix);
      hasher.update(this.value);
      this.hash = hasher.digest("hex");
    }
    return this.hash;
  }

  invalidateHash(): void {
    this.hash = null;
  }
}

export class TreeOfWisdom {
  private root: Node | null;

  constructor() {
    this.root = null;
  }

  /**
   * Returns the root node of the Tree of Wisdom. If the tree is empty, the method returns null.
   * @returns {Node | null} The root node of the tree if it exists, or null if the tree is empty.
   * @example const root = tree.getRoot();
   */
  public getRoot(): Node | null {
    return this.root;
  }

  /**
   * Returns the hash of the root node of the Tree of Wisdom. If the tree is empty, the method
   * returns the hash of an empty string.
   * @returns {string} The hash of the root node of the tree if it exists, or the hash of an empty
   * string if the tree is empty.
   * @example const rootHash = tree.getRootHash();
   */
  public getRootHash(): string {
    if (!this.root) {
      // Tree is empty return hash of empty string
      return "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    } else {
      return this.root.getHash();
    }
  }

  /**
   * Returns true if the given object is an instance of a Node,
   * i.e. a LeafNode, ExtensionNode, or BranchNode.
   * @param {any} node - The object to be checked.
   * @returns {boolean} True if the object is an instance of a Node, false otherwise.
   * @example if (TreeOfWisdom.isNodeInstance(node)) { ... }
   */
  public static isNodeInstance(node: any): node is Node {
    return (
      node instanceof LeafNode ||
      node instanceof ExtensionNode ||
      node instanceof BranchNode
    );
  }

  /**
   * Inserts a key-value pair into the Tree of Wisdom. If the key already exists, its value
   * is updated. The method ensures that keys are unique within the tree.
   *
   * @param {string} key - The key under which the value is to be inserted. Only hex strings are
   * supported as keys. (0-9, A-F)
   * @param {Buffer} value - The value to be inserted. This can be any binary data, including
   * serialized objects, strings, or other data types.
   * @throws {Error} if the key is invalid or cannot be inserted for any reason, an error is thrown
   * with an appropriate message.
   * @returns {void}
   * @example tree.set('0A1B2C3D', Buffer.from('Hello, World!'));
   */
  public set(key: string, value: Buffer): void {
    if (!this.isHexKey(key)) {
      throw new Error("Invalid key: Keys must be valid hex strings.");
    }
    this.root = this.insertRecursive(this.root, key.toUpperCase(), value, "");
  }

  private findCommonPrefixLength(s1: string, s2: string): number {
    let i = 0;
    while (i < s1.length && i < s2.length && s1[i] === s2[i]) {
      i++;
    }
    return i;
  }

  /**
   * Retrieves the value associated with a given key from the Tree of Wisdom. This method
   * initiates a recursive search starting from the root node, following the path dictated by
   * the key. Keys are case-insensitive.
   *
   * @param {string} key - The key for which the value is to be retrieved. The key is treated
   * case-insensitively and should match the format used during insertion. Only hex strings are
   * supported as keys. (0-9, A-F)
   * @returns {Buffer | Node | null} The value associated with the key if found, returned as a Buffer.
   * If the key leads to a node (Branch or Extension) without a direct value, the node itself is returned,
   * allowing for further manual inspection or operations. Returns null if the key is not found in the tree.
   * @throws {Error} if the key is invalid, an error is thrown with an appropriate message.
   * @example const value = tree.get('0A1B2C3D');
   */
  public get(key: string): Buffer | null {
    if (!this.isHexKey(key)) {
      throw new Error("Invalid key: Keys must be valid hex strings.");
    }
    if (!this.root) {
      return null;
    }

    let node = this.retrieveRecursive(this.root, key.toUpperCase());
    if (TreeOfWisdom.isNodeInstance(node)) {
      throw new Error("Invalid tree structure: Node found instead of value.");
    }

    return node;
  }

  /**
   * Retrieves the node associated with a given key from the tree. This method
   * initiates a recursive search starting from the root node, following the path dictated by
   * the key. Keys are case-insensitive.
   *
   * @param {string} key - The key for which the node is to be retrieved. The key is treated
   * case-insensitively and should match the format used during insertion. Only hex strings are
   * supported as keys. (0-9, A-F)
   * @returns {Node | null} The node associated with the key if found. Returns null if the key is not found in the tree.
   * @throws {Error} if the key is invalid, an error is thrown with an appropriate message.
   * @example tree.getNode('0A1B2C3D');
   */
  public getNode(key: string): Node | null {
    if (!this.isHexKey(key)) {
      throw new Error("Invalid key: Keys must be valid hex strings.");
    }
    if (!this.root) {
      return null;
    }

    return this.getNodeRecursive(this.root, key.toUpperCase(), "");
  }

  private getNodeRecursive(node: Node, key: string, path: string): Node | null {
    // This method mirrors the existing retrieve logic but returns the node itself instead of the value.
    switch (node.getType()) {
      case "leaf":
        const leafNode = node as LeafNode;
        if (leafNode.getSuffix() === key) {
          return leafNode;
        }
        break;
      case "extension":
        const extensionNode = node as ExtensionNode;
        // If key is empty, return the extension node itself
        if (key.length === 0) {
          return extensionNode;
        }

        if (key.startsWith(extensionNode.getSegment())) {
          return this.getNodeRecursive(
            extensionNode.getChild(),
            key.substring(extensionNode.getSegment().length),
            path + extensionNode.getSegment()
          );
        }
        break;
      case "branch":
        if (key.length === 0) {
          return node; // The branch itself is the target if the key is exhausted.
        }
        const nibble = this.parseSingleNibble(key[0]);
        const child = (node as BranchNode).getChild(nibble);
        if (child && TreeOfWisdom.isNodeInstance(child)) {
          return this.getNodeRecursive(
            child,
            key.substring(1),
            path + nibble.toString(16).toUpperCase()
          );
        }
        break;
    }
    return null; // Node not found for the given key.
  }

  /**
   * Deletes a key-value pair from the Tree of Wisdom. If the key is not found in the tree, the
   * method does nothing. The deletion process is initiated from the root node and follows the
   * path dictated by the key. Keys are case-insensitive.
   * @param {string} key - The key for which the value is to be deleted. The key is treated
   * case-insensitively and should match the format used during insertion. Only hex strings are
   * supported as keys. (0-9, A-F)
   * @throws {Error} if the key is invalid or cannot be deleted for any reason, an error is thrown
   * with an appropriate message.
   * @returns {void}
   * @example tree.delete('0A1B2C3D');
   */
  public delete(key: string): void {
    if (!this.isHexKey(key)) {
      throw new Error("Invalid key: Keys must be valid hex strings.");
    }
    if (!this.root) return; // Tree is empty, nothing to delete
    this.root = this.deleteRecursive(this.root, key.toUpperCase(), "");
  }

  /**
   * Finds the node matching the given key and drops the entire subtree rooted at that node.
   * This method is useful for efficiently deleting a large number of keys with a common prefix.
   * @param {string} prefix - The prefix of the keys to be deleted. The prefix is treated
   * case-insensitively. Only hex strings are supported as keys. (0-9, A-F)
   * @throws {Error} if the prefix is invalid or cannot be deleted for any reason, an error is thrown
   * with an appropriate message.
   * @returns {void}
   * @example tree.dropSubtree('0A1B2C');
   */
  public dropSubtree(prefix: string): void {
    if (!this.isHexKey(prefix)) {
      throw new Error("Invalid prefix: Prefix must be a valid hex string.");
    }
    if (!this.root) return; // If the tree is empty, there's nothing to do

    // Normalize the prefix to upper case for consistent matching
    prefix = prefix.toUpperCase();

    // Special case: If the prefix is empty, clear the entire tree
    if (prefix === "") {
      this.root = null;
      return;
    }

    // Start the recursive dropping process from the root
    this.root = this.dropSubtreeRecursive(this.root, prefix);
  }

  /**
   * Traverses one level of the tree from the given node, resolving extensions to their attached branches.
   *
   * @param {Node | null} node - The starting node for traversal.
   * @returns {Array<Node | null>} An array of up to 16 nodes, representing the children of the input node, excluding Buffer objects.
   */
  public traverseOneLevel(node: Node | null): Array<Node | null> {
    if (!node) {
      // If the node is null, throw an error
      throw new Error("Invalid node: Cannot traverse children of a null node.");
    }

    switch (node.getType()) {
      case "branch":
        // For branch nodes, filter out Buffer objects and resolve extensions.
        let children = (node as BranchNode).getChildren();
        // resolve all extension children
        children = children.map((child) => {
          if (child instanceof ExtensionNode) {
            if (child.getChild().getType() !== "branch") {
              throw new Error(
                "Invalid tree structure: Extension node points to non-branch node."
              );
            }
            return child.getChild();
          }
          if (TreeOfWisdom.isNodeInstance(child)) {
            return child;
          }
          return null;
        });
        // prune all null children
        children = children.filter((child) => child !== null);
        return children as Array<Node | null>;

      case "extension":
        // For extension nodes, follow the extension to its child.
        const child = (node as ExtensionNode).getChild();
        if (child.getType() === "branch") {
          return [child];
        }

        // Throw an error if an extension node points directly to null or a leaf node.
        throw new Error(
          "Invalid tree structure: Extension node points directly to a leaf node."
        );
        break;

      case "leaf":
        // Leaf nodes do not have children in the context of this traversal, return an empty array.
        return [];
    }

    // For any other case or if the node type is not handled, return an empty array.
    return [];
  }

  /**
   * Collects and returns statistics about the tree, including the number of each type of node,
   * total keys, and embedded children. This helps in understanding the distribution and structure
   * of the tree, useful for optimization and debugging purposes.
   *
   * @returns An object containing statistics such as branchNodes, extensionNodes, leafNodes,
   * totalKeys, embeddedChildren, and the root hash of the tree.
   */
  public getTreeStatistics(): any {
    const stats = {
      branchNodes: 0,
      extensionNodes: 0,
      leafNodes: 0,
      totalKeys: 0, // Count of all keys (values in leaves + branch values + embedded children)
      embeddedChildren: 0, // Count of embedded children in branches
      rootHash: this.getRootHash(),
    };

    this.traverseNodes(this.root, (node: Node) => {
      switch (node.getType()) {
        case "branch":
          stats.branchNodes++;
          const branchNode = node as BranchNode;
          // Count the value directly stored in the branch node, if any
          if (branchNode.getValue() !== null) {
            stats.totalKeys++;
          }
          // Only count embedded children as keys, do not increment for pointer children
          branchNode.getChildren().forEach((child) => {
            if (
              child !== null &&
              !(child instanceof LeafNode) &&
              !(child instanceof ExtensionNode) &&
              !(child instanceof BranchNode)
            ) {
              // It's an embedded child if it's not an instance of LeafNode, ExtensionNode, or BranchNode
              stats.embeddedChildren++;
              stats.totalKeys++; // Corrected to only increment for actual values (embedded children)
            }
          });
          break;
        case "extension":
          stats.extensionNodes++;
          break;
        case "leaf":
          stats.leafNodes++;
          // Each leaf node counts as a key
          stats.totalKeys++;
          break;
      }
    });

    return stats;
  }

  /**
   * Prints statistics about the tree, including the number of each type of node, total keys, and
   * embedded children. This method provides a quick overview of the tree's structure and distribution.
   * @returns {void}
   * @example tree.printTreeStatistics();
   */
  public printTreeStatistics(): void {
    const stats = this.getTreeStatistics();
    console.log("Tree of Wisdom Statistics:");
    console.log(`- Branch Nodes: ${stats.branchNodes}`);
    console.log(`- Extension Nodes: ${stats.extensionNodes}`);
    console.log(`- Leaf Nodes: ${stats.leafNodes}`);
    console.log(`- Total Keys: ${stats.totalKeys}`);
    console.log(`- Embedded Children in Branches: ${stats.embeddedChildren}`);
    console.log(`- Root Hash: ${stats.rootHash}`);
  }

  /**
   * Prints the structure of the tree in an ASCII art format for visualization. This method
   * highlights the hierarchical arrangement of nodes (branch, extension, and leaf) and displays key
   * attributes such as paths, keys, values, and hashes to provide insight into the tree's current state.
   * @returns {void}
   * @example tree.printTree();
   */
  public printTree(): void {
    console.log("Tree of Wisdom Structure:");
    this.printNode(this.root, "", true, "");
  }

  // Implements the logic for handling insertions at leaf nodes
  private handleLeafNode(leafNode: LeafNode, key: string, value: Buffer): Node {
    const commonPrefixLength = this.findCommonPrefixLength(
      leafNode.getSuffix(),
      key
    );
    if (
      commonPrefixLength === leafNode.getSuffix().length &&
      commonPrefixLength === key.length
    ) {
      // The keys fully match, update the value of the existing leaf node
      leafNode.setValue(value);
      return leafNode;
    } else if (commonPrefixLength > 0) {
      // Split the leaf node into an extension (if necessary) and branch node
      return this.splitLeafNode(leafNode, key, value, commonPrefixLength);
    } else {
      // No common prefix, create a branch node and insert both the existing leaf and the new leaf under it
      return this.createBranchNodeFromLeaves(
        leafNode.getSuffix(),
        leafNode.getValue(),
        key,
        value
      );
    }
  }

  // Implements the logic for handling insertions at extension nodes
  private handleExtensionNode(
    extensionNode: ExtensionNode,
    key: string,
    value: Buffer
  ): Node {
    const commonPrefixLength = this.findCommonPrefixLength(
      extensionNode.getSegment(),
      key
    );
    if (
      commonPrefixLength === 0 ||
      commonPrefixLength < extensionNode.getSegment().length
    ) {
      // No common prefix or partial common prefix, need to adjust the extension node
      return this.adjustExtensionNode(
        extensionNode,
        key,
        value,
        commonPrefixLength
      );
    } else {
      // Key extends beyond the extension's segment, insert into or replace the child node
      const newChild = this.insertRecursive(
        extensionNode.getChild(),
        key.substring(commonPrefixLength),
        value,
        ""
      );
      extensionNode.setChild(newChild);
      return extensionNode;
    }
  }

  // Implements the logic for handling insertions at branch nodes
  private handleBranchNode(
    branchNode: BranchNode,
    key: string,
    value: Buffer,
    path: string
  ): Node {
    if (key.length === 0) {
      // If the key is exhausted, set the value directly on the branch node
      branchNode.setValue(value);
      return branchNode;
    } else if (
      key.length === 1 &&
      branchNode.getChild(this.parseSingleNibble(key[0])) === null
    ) {
      // if the key is exhausted, set the value directly on the children array of branch node
      const nibble = this.parseSingleNibble(key[0]);
      branchNode.setChild(nibble, value);
      return branchNode;
    } else {
      const nibble = this.parseSingleNibble(key[0]);
      let child = branchNode.getChild(nibble);
      if (!child) {
        // If there is no child at the nibble index, create a new LeafNode
        child = new LeafNode(key.substring(1), value);
      } else {
        // If a child exists, insert recursively into the child
        // If the child is a Buffer and not a leaf yet, update the child to a LeafNode first
        if (TreeOfWisdom.isNodeInstance(child) === false) {
          child = new LeafNode(key.substring(1), child as Buffer);
        }
        child = this.insertRecursive(
          child,
          key.substring(1),
          value,
          path + nibble.toString(16).toUpperCase()
        );
      }
      branchNode.setChild(nibble, child);
      return branchNode;
    }
  }

  // Create a new branch node from two leaf nodes
  private createBranchNodeFromLeaves(
    key1: string,
    value1: Buffer,
    key2: string,
    value2: Buffer
  ): Node {
    const branchNode = new BranchNode();
    if (key1 === key2) {
      throw new Error(
        "Error: Attempted to insert two identical keys into a branch."
      );
    }

    // If key1 length is 0, set the value directly in the branch node
    if (key1.length === 0) {
      branchNode.setValue(value1);
    } else if (key1.length === 1) {
      // If key1 length is 1, set the value directly in the branch node
      branchNode.setChild(this.parseSingleNibble(key1[0]), value1);
    } else {
      // Create a new leaf node for the remaining part of the key1
      const nibble1 = this.parseSingleNibble(key1[0]);
      branchNode.setChild(nibble1, new LeafNode(key1.substring(1), value1));
    }

    // If key2 is empty, this indicates a logical error since key2 comes from a new insertion
    if (key2.length === 0) {
      console.error("Error: Attempted to insert an empty key as a new leaf.");
    } else if (key2.length === 1) {
      // If key2 length is 1, set the value directly in the branch node
      branchNode.setChild(this.parseSingleNibble(key2[0]), value2);
    } else {
      // Create a new leaf node for the remaining part of the key2
      const nibble2 = this.parseSingleNibble(key2[0]);
      branchNode.setChild(nibble2, new LeafNode(key2.substring(1), value2));
    }

    return branchNode;
  }

  // Parse a single nibble from a hex string
  private parseSingleNibble(key: string): number {
    const nibble = parseInt(key[0], 16);
    if (Number.isNaN(nibble) || nibble < 0 || nibble > 15) {
      throw new Error("Invalid nibble");
    }
    return nibble;
  }

  // Split a leaf node into an extension and branch node
  private splitLeafNode(
    leafNode: LeafNode,
    key: string,
    value: Buffer,
    commonPrefixLength: number
  ): Node {
    const segment = leafNode.getSuffix().substring(0, commonPrefixLength);
    const remainderLeafKey = leafNode.getSuffix().substring(commonPrefixLength);
    const remainderNewKey = key.substring(commonPrefixLength);

    const branchNode = new BranchNode();

    // Convert values to Buffer if not already
    const bufferValue = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const bufferLeafValue = Buffer.isBuffer(leafNode.getValue())
      ? leafNode.getValue()
      : Buffer.from(leafNode.getValue());

    // Handling for the existing leaf node
    if (remainderLeafKey.length === 0) {
      // If the remainder of the leaf key is empty, set the value directly on the branch node
      branchNode.setValue(bufferLeafValue);
    } else {
      const nibbleRemainderLeaf = this.parseSingleNibble(remainderLeafKey[0]);
      if (remainderLeafKey.length === 1) {
        // Directly embed the value if the remaining key is exactly one nibble
        branchNode.setChild(nibbleRemainderLeaf, bufferLeafValue);
      } else {
        // Create a new leaf node for the remaining part of the leaf key
        branchNode.setChild(
          nibbleRemainderLeaf,
          new LeafNode(remainderLeafKey.substring(1), bufferLeafValue)
        );
      }
    }

    // Handling for the new key-value pair
    if (remainderNewKey.length === 0) {
      // If the remainder of the new key is empty, set the value directly on the branch node
      branchNode.setValue(bufferValue);
    } else {
      const nibbleRemainderNew = this.parseSingleNibble(remainderNewKey[0]);
      if (remainderNewKey.length === 1) {
        // Directly embed the value if the remaining key is exactly one nibble
        branchNode.setChild(nibbleRemainderNew, bufferValue);
      } else {
        // Create a new leaf node for the remaining part of the new key
        branchNode.setChild(
          nibbleRemainderNew,
          new LeafNode(remainderNewKey.substring(1), bufferValue)
        );
      }
    }

    if (commonPrefixLength > 0) {
      return new ExtensionNode(segment, branchNode);
    } else {
      return branchNode;
    }
  }

  // Adjust an extension node to accommodate a new key-value pair
  private adjustExtensionNode(
    extensionNode: ExtensionNode,
    key: string,
    value: Buffer,
    commonPrefixLength: number
  ): Node {
    const segment = extensionNode.getSegment();
    const commonPrefix = segment.substring(0, commonPrefixLength);
    const remainderExtension = segment.substring(commonPrefixLength);
    const remainderKey = key.substring(commonPrefixLength);

    // Create a branch node as a new common parent
    const branchNode = new BranchNode();
    if (remainderExtension !== "") {
      // Adjusting within the extension's segment, move the remaining part of the extension's segment and its child to a new extension node if necessary
      const newExtensionNode =
        remainderExtension.length > 1
          ? new ExtensionNode(
              remainderExtension.substring(1),
              extensionNode.getChild()
            )
          : extensionNode.getChild(); // If the remainderExtension is only one character, use the child directly
      branchNode.setChild(
        this.parseSingleNibble(remainderExtension[0]),
        newExtensionNode
      );
    }

    if (remainderKey !== "") {
      // If there is a remainder of the key, create a new leaf node for it
      branchNode.setChild(
        this.parseSingleNibble(remainderKey[0]),
        new LeafNode(remainderKey.substring(1), value)
      );
    } else {
      // If the remainderKey is empty, it means the new value should be inserted directly at the branch node
      branchNode.setValue(value);
    }

    if (commonPrefixLength > 0) {
      // If there's still a common prefix, keep it in a new extension node
      return new ExtensionNode(commonPrefix, branchNode);
    } else {
      // Otherwise, the branch node itself is sufficient
      return branchNode;
    }
  }

  // Method to insert a key-value pair into the tree recursively
  private insertRecursive(
    node: Node | null,
    key: string,
    value: Buffer,
    path: string
  ): Node {
    if (!node) {
      return new LeafNode(key, value);
    }

    switch (node.getType()) {
      case "leaf":
        return this.handleLeafNode(node as LeafNode, key, value);
      case "extension":
        return this.handleExtensionNode(node as ExtensionNode, key, value);
      case "branch":
        return this.handleBranchNode(node as BranchNode, key, value, path);
      default:
        throw new Error(`Unknown node type: ${node.getType()}`);
    }
  }

  // function to verify keys are valid hex strings
  private isHexKey(key: string): boolean {
    return /^[0-9A-F]*$/i.test(key);
  }

  private retrieveRecursive(node: Node, key: string): Buffer | Node | null {
    if (node.getType() === "leaf") {
      const leafNode = node as LeafNode;
      if (leafNode.getSuffix() === key) {
        return leafNode.getValue();
      } else {
        return null;
      }
    } else if (node.getType() === "extension") {
      const extensionNode = node as ExtensionNode;
      const segment = extensionNode.getSegment();
      if (key.startsWith(segment)) {
        return this.retrieveRecursive(
          extensionNode.getChild(),
          key.substring(segment.length)
        );
      } else {
        return null;
      }
    } else if (node.getType() === "branch") {
      const branchNode = node as BranchNode;
      if (key.length === 0) {
        // Return the value stored directly in the branch node if the key is exhausted
        return branchNode.getValue();
      } else {
        const nibble = this.parseSingleNibble(key[0]);
        const child = branchNode.getChild(nibble);
        if (!child) {
          return null;
        }
        // If the child is a Buffer, return its value directly
        if (TreeOfWisdom.isNodeInstance(child) === false) {
          return child;
        } else {
          return this.retrieveRecursive(child, key.substring(1));
        }
      }
    }

    return null;
  }

  /**
   * Traverses the tree in order to delete a node from the tree.
   * @param {Node | null} node - The starting node for the deletion.
   * @param {string} key - The key to be deleted.
   * @param {string} path - The path to the current node.
   * @returns {Node | null} The new node after deletion, or null if the node was deleted.
   * @throws {Error} if the key is invalid, an error is thrown with an appropriate message.
   * @example tree.deleteRecursive(tree.getRoot(), '0A1B2C3D', '');
   */
  private deleteRecursive(
    node: Node | null,
    key: string,
    path: string
  ): Node | null {
    if (!node) return null; // Node does not exist, nothing to delete

    switch (node.getType()) {
      case "leaf":
        return this.deleteFromLeafNode(node as LeafNode, key, path);
      case "extension":
        return this.deleteFromExtensionNode(node as ExtensionNode, key, path);
      case "branch":
        return this.deleteFromBranchNode(node as BranchNode, key, path);
      default:
        throw new Error(`Unknown node type: ${node.getType()}`);
    }
  }

  private deleteFromLeafNode(
    leafNode: LeafNode,
    key: string,
    path: string
  ): Node | null {
    if (leafNode.getSuffix() === key) {
      // Key matches, delete this leaf node
      return null;
    }
    // Key does not match, nothing to delete
    throw new Error("Deleting invalid key.");
    return leafNode;
  }

  private deleteFromExtensionNode(
    extensionNode: ExtensionNode,
    key: string,
    path: string
  ): Node | null {
    const segment = extensionNode.getSegment();
    if (key.startsWith(segment)) {
      // Proceed with deletion in the child node
      const newChild = this.deleteRecursive(
        extensionNode.getChild(),
        key.substring(segment.length),
        path + segment
      );
      if (!newChild) {
        // Child was deleted, delete this extension node
        return null;
      } else if (newChild instanceof LeafNode) {
        // Adjust the leaf node's key to include the extension's prefix
        // This is necessary if the leaf node is being directly passed up through an extension node
        (newChild as LeafNode).setSuffix(
          segment + (newChild as LeafNode).getSuffix()
        );
        return newChild;
      } else if (
        // Branch with only one value found, this should have been converted to a leaf node
        newChild.getType() === "branch" &&
        ((newChild.getValue() !== null &&
          this.countNonNullChildren(newChild as BranchNode) === 0) ||
          (newChild.getValue() !== null &&
            this.countNonNullChildren(newChild as BranchNode) === 1))
      ) {
        throw new Error(
          "Invalid tree structure: Branch node with single value."
        );
      } else if (newChild.getType() === "branch") {
        // For branch nodes with multiple children, simply update the extension node's child
        extensionNode.setChild(newChild);
        return extensionNode;
      } else if (newChild.getType() === "extension") {
        // If the new child is an extension node, we need to merge the segments
        let extensionChild = newChild as ExtensionNode;
        const newSegment = segment + extensionChild.getSegment();
        extensionChild.setSegment(newSegment);
        return extensionChild;
      }
      // If the new child is not a leaf, branch, or extension node, it's an invalid type
      // (e.g. buffer), so we throw an error
      throw new Error(
        "Extension node has an invalid child type: " + newChild.constructor.name
      );
    }
    // Prefix does not match, nothing to delete
    return extensionNode;
  }

  private deleteFromBranchNode(
    branchNode: BranchNode,
    key: string,
    path: string
  ): Node | null {
    if (key.length === 0) {
      branchNode.setValue(null);
    } else {
      const nibble = this.parseSingleNibble(key[0]);
      let child = branchNode.getChild(nibble);
      if (child) {
        if (!TreeOfWisdom.isNodeInstance(child)) {
          branchNode.setChild(nibble, null);
        } else {
          const newChild = this.deleteRecursive(
            child,
            key.substring(1),
            path + nibble.toString(16).toUpperCase()
          );
          branchNode.setChild(nibble, newChild);
        }
      }
    }

    // Check if the branch node should be simplified or converted
    const nonNullChildren = branchNode
      .getChildren()
      .filter((child) => child !== null);
    if (nonNullChildren.length === 1 && branchNode.getValue() === null) {
      // Single child case
      const singleChildIndex = branchNode
        .getChildren()
        .findIndex((child) => child !== null);
      const singleChild = nonNullChildren[0];

      if (TreeOfWisdom.isNodeInstance(singleChild)) {
        // If the single child is a node, we need to adjust its key or segment
        if (singleChild.getType() === "leaf") {
          // Convert branch node to a leaf node with adjusted key
          const leafNode = singleChild as LeafNode;
          const newKey =
            singleChildIndex.toString(16).toUpperCase() + leafNode.getSuffix();
          return new LeafNode(newKey, leafNode.getValue());
        } else if (singleChild.getType() === "extension") {
          // Adjust the segment of the extension node
          const extensionNode = singleChild as ExtensionNode;
          const newSegment =
            singleChildIndex.toString(16).toUpperCase() +
            extensionNode.getSegment();
          return new ExtensionNode(newSegment, extensionNode.getChild());
        } else if (singleChild.getType() === "branch") {
          // Convert single child branch into extension node
          const singleChildBranch = singleChild as BranchNode;
          const newSegment = singleChildIndex.toString(16).toUpperCase();
          return new ExtensionNode(newSegment, singleChildBranch);
        }
        // If the single child is not a leaf, extension, or branch node, it's an invalid type
        throw new Error("Invalid node type: " + singleChild.constructor.name);
      } else if (singleChild instanceof Buffer) {
        // Directly embedded value in branch, convert to leaf node
        const newKey = path + singleChildIndex.toString(16).toUpperCase();
        return new LeafNode(newKey, singleChild);
      }
    } else if (branchNode.getValue() !== null && nonNullChildren.length === 0) {
      // Branch node has a value but no children, convert to a leaf node
      const value = branchNode.getValue();
      if (value) {
        // Ensure value is not null
        return new LeafNode(path, value);
      }
    }

    // If the branch node doesn't need to be simplified or converted, return it as is
    return branchNode;
  }

  private countNonNullChildren(branchNode: BranchNode): number {
    return branchNode.getChildren().filter((child) => child !== null).length;
  }

  private dropSubtreeRecursive(node: Node | null, prefix: string): Node | null {
    if (!node || prefix === "") {
      // If we've reached the node to drop or the prefix is exhausted, return null to remove the node
      return null;
    }

    switch (node.getType()) {
      case "extension":
        const extensionNode = node as ExtensionNode;
        const segment = extensionNode.getSegment();
        if (prefix.startsWith(segment)) {
          // If the prefix starts with the extension node's segment, proceed down the subtree
          const newChild = this.dropSubtreeRecursive(
            extensionNode.getChild(),
            prefix.substring(segment.length)
          );
          if (!newChild) {
            // If the child has been removed, remove the extension node as well
            return null;
          } else {
            // Otherwise, update the child node
            extensionNode.setChild(newChild);
            return extensionNode;
          }
        } else {
          // If the prefix does not match the extension's segment, keep the node as is
          return node;
        }
      case "branch":
        const branchNode = node as BranchNode;
        const nibble = this.parseSingleNibble(prefix[0]);
        const child = branchNode.getChild(nibble);
        if (child) {
          if (TreeOfWisdom.isNodeInstance(child)) {
            // Only proceed with recursion if the child is a Node instance
            const newChild = this.dropSubtreeRecursive(
              child,
              prefix.substring(1)
            );
            branchNode.setChild(nibble, newChild);
          } else {
            // If the child is a Buffer, it should be removed if the prefix indicates this subtree
            if (prefix.length <= 1) {
              // If the prefix exactly matches the location of the Buffer, remove it
              branchNode.setChild(nibble, null);
            }
            // If the prefix is longer, it implies the Buffer does not match the full prefix,
            // and since Buffers represent leaf values, there's no further subtree to remove,
            // so we leave the structure unchanged beyond this point.
          }
        }
        // After potentially modifying a child, check if the branch node has become empty
        if (
          branchNode.getChildren().every((child) => child === null) &&
          !branchNode.getValue()
        ) {
          // If the branch node no longer has any children or a value, it should be removed
          return null;
        }
        return branchNode;
      case "leaf":
        const leafNode = node as LeafNode;
        // Leaf nodes match if their suffix starts with the remaining prefix
        if (leafNode.getSuffix().startsWith(prefix)) {
          return null; // Remove the leaf node if it matches the prefix
        }
        return node; // Keep the leaf node if it does not match the prefix
      default:
        return node; // For any unknown type, return the node unchanged
    }
  }

  // Helper function to traverse the tree and apply a function to each node
  private traverseNodes(
    node: Node | null,
    callback: (node: Node) => void
  ): void {
    if (!node) return;
    callback(node);
    if (node.getType() === "branch") {
      const branchNode = node as BranchNode;
      for (let i = 0; i < BranchNode.BRANCH_NODE_CHILDREN; i++) {
        const child = branchNode.getChild(i);
        if (TreeOfWisdom.isNodeInstance(child)) {
          this.traverseNodes(child, callback);
        }
      }
    } else if (node.getType() === "extension") {
      const extensionNode = node as ExtensionNode;
      this.traverseNodes(extensionNode.getChild(), callback);
    }
    // Leaf nodes do not have children, so no further action is required
  }

  // Define this.COLORS with an index signature
  private COLORS: { [key: string]: string } = {
    branch: "\x1b[90m", // Gray
    extension: "\x1b[37m", // Light Gray
    embedded: "\x1b[32m", // Dark Green
    leaf: "\x1b[92m", // Light Green
    reset: "\x1b[0m", // Reset to default terminal color
  };

  /**
   * Recursively prints the structure of the tree in an ASCII art format for visualization. This method
   * highlights the hierarchical arrangement of nodes (branch, extension, and leaf) and displays key
   * attributes such as paths, keys, values, and hashes to provide insight into the tree's current state.
   *
   * @param {Node | null} node - The current node being printed.
   * @param {string} prefix - The prefix for lines to maintain the tree structure visually.
   * @param {boolean} isTail - Indicates if the node is the last child in its set of siblings, affecting the leading character.
   * @param {string} path - Accumulated path to the current node, representing the concatenated keys from the root.
   */
  private printNode(
    node: Node | null,
    prefix: string,
    isTail: boolean,
    path: string // Path to the node
  ): void {
    if (!node) return;

    const lead = prefix + (isTail ? "└── " : "├── ");
    const hash = node.getHash(); // Get hash of the node
    switch (node.getType()) {
      case "branch":
        const branchNode = node as BranchNode;
        const branchValue = branchNode.getValue()?.toString() ?? "null";
        console.log(
          `${lead}${this.COLORS["branch"]}Branch${this.COLORS["reset"]} [${
            path ? "Path:" + path : "Root"
          }, Hash: ${hash.substring(0, 8)}]`
        );
        // Check for a directly stored value in the branch node (in case of exhausted key)
        if (branchNode.getValue() !== null) {
          console.log(
            `${prefix + (isTail ? "    " : "│   ")}├── ${
              this.COLORS["embedded"]
            }Embedded${this.COLORS["reset"]} [Value: ${branchValue}]`
          );
        }
        for (let i = 0; i < BranchNode.BRANCH_NODE_CHILDREN; i++) {
          const child = branchNode.getChild(i);
          if (child) {
            const fullKey = path + i.toString(16).toUpperCase();
            if (TreeOfWisdom.isNodeInstance(child) === false) {
              // Directly print the value for leaves embedded as Buffer in branches
              console.log(
                `${prefix + (isTail ? "    " : "│   ")}├── ${
                  this.COLORS["embedded"]
                }Embedded${
                  this.COLORS["reset"]
                } [Key: ${fullKey}, Value: ${child.toString()} (Path: ${path}, Slot: ${i
                  .toString(16)
                  .toUpperCase()})]`
              );
            } else {
              // Recursively print node children (LeafNode, ExtensionNode, BranchNode)
              this.printNode(
                child,
                prefix + (isTail ? "    " : "│   "),
                false, // Adjusted to ensure proper tree structure visualization
                fullKey
              );
            }
          }
        }
        break;
      case "extension":
        const extensionNode = node as ExtensionNode;
        console.log(
          `${lead}${this.COLORS["extension"]}Extension${
            this.COLORS["reset"]
          } [Path: ${path} Segment: ${extensionNode.getSegment()}, Hash: ${hash.substring(
            0,
            8
          )}]`
        );
        // Append the extension prefix to the path correctly
        this.printNode(
          extensionNode.getChild(),
          prefix + (isTail ? "    " : "│   "),
          true,
          path + extensionNode.getSegment() // Append the extension prefix to the path
        );
        break;
      case "leaf":
        const leafNode = node as LeafNode;
        // Correctly display the full key for leaf nodes
        console.log(
          `${lead}${this.COLORS["leaf"]}Leaf${this.COLORS["reset"]} [Key: ${
            path + leafNode.getSuffix()
          }, Value: ${leafNode.getValue()} (Path: ${path} Suffix: ${leafNode.getSuffix()}) Hash: ${hash.substring(
            0,
            8
          )}]`
        );
        break;
    }
  }
}
