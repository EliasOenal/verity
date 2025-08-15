/**
 * Simple native DoublyLinkedList implementation to replace data-structure-typed dependency.
 * Only implements the methods actually used by continuation.ts.
 */

export class DoublyLinkedListNode<T> {
  public value: T;
  public next: DoublyLinkedListNode<T> | undefined;
  public prev: DoublyLinkedListNode<T> | undefined;

  constructor(value: T) {
    this.value = value;
    this.next = undefined;
    this.prev = undefined;
  }
}

export class DoublyLinkedList<T> {
  public head: DoublyLinkedListNode<T> | undefined;
  public tail: DoublyLinkedListNode<T> | undefined;
  private _size = 0;

  constructor() {
    this.head = undefined;
    this.tail = undefined;
  }

  get size(): number {
    return this._size;
  }

  /**
   * Add element to the end of the list
   */
  push(value: T): DoublyLinkedListNode<T> {
    const node = new DoublyLinkedListNode(value);
    
    if (!this.head) {
      this.head = node;
      this.tail = node;
    } else {
      node.prev = this.tail;
      this.tail!.next = node;
      this.tail = node;
    }
    
    this._size++;
    return node;
  }

  /**
   * Add element after the specified node
   */
  addAfter(existingNode: DoublyLinkedListNode<T>, value: T): DoublyLinkedListNode<T> {
    const newNode = new DoublyLinkedListNode(value);
    
    newNode.next = existingNode.next;
    newNode.prev = existingNode;
    
    if (existingNode.next) {
      existingNode.next.prev = newNode;
    } else {
      // existingNode was the tail
      this.tail = newNode;
    }
    
    existingNode.next = newNode;
    this._size++;
    
    return newNode;
  }

  /**
   * Add element before the specified node
   */
  addBefore(existingNode: DoublyLinkedListNode<T>, value: T): DoublyLinkedListNode<T> {
    const newNode = new DoublyLinkedListNode(value);
    
    newNode.next = existingNode;
    newNode.prev = existingNode.prev;
    
    if (existingNode.prev) {
      existingNode.prev.next = newNode;
    } else {
      // existingNode was the head
      this.head = newNode;
    }
    
    existingNode.prev = newNode;
    this._size++;
    
    return newNode;
  }
}