import { describe, it, expect, vi } from "vitest";
import { RecursiveEmitter, RecursiveEmitterConstituent, RecursiveEmitterRecord } from "../../../src/core/helpers/recursiveEmitter";

import { EventEmitter } from "events";

// Prepare some test emitters

/**
 * Dummy emitter class implementing the RecursiveEmitterConstituent interface.
 * It extends Node's EventEmitter and provides an async generator getSubemitters().
 */
class TestEmitter extends EventEmitter implements RecursiveEmitterConstituent {
  // subEmitters is an array of RecursiveEmitterConstituent instances.
  constructor(public subEmitters: RecursiveEmitterConstituent[] = []) {
    super();
  }
  // Returns an async generator that yields each subemitter wrapped in a resolved promise.
  async *getSubemitters(): AsyncGenerator<RecursiveEmitterConstituent> {
    for (const sub of this.subEmitters) {
      yield sub;
    }
  }
}

/**
 * A self-referencing emitter class that yields itself as a subemitter.
 * This is useful to test duplicate prevention (and to avoid infinite recursion).
 */
class SelfReferencingEmitter extends EventEmitter {
  async *getSubemitters() {
    yield Promise.resolve(this);
  }
}

/**
 * Faulty emitter that simulates a rejected subemitter promise.
 */
class FaultyEmitter extends EventEmitter {
  async *getSubemitters(): AsyncGenerator<RecursiveEmitterConstituent> {
    yield Promise.reject(new Error("Fault in subemitter"));
  }
}

/**
 * Emitter whose getSubemitters yields the same emitter multiple times.
 */
class DuplicateYieldEmitter extends TestEmitter {
  async *getSubemitters(): AsyncGenerator<RecursiveEmitterConstituent> {
    // Yield the first subemitter twice.
    if (this.subEmitters[0]) {
      yield Promise.resolve(this.subEmitters[0]);
      yield Promise.resolve(this.subEmitters[0]);
    }
  }
}



describe("RecursiveEmitter", () => {
  describe('basic event emissions', () => {
    it("should re-emit an event from a simple emitter", async () => {
      const dummy = new TestEmitter();
      const record: RecursiveEmitterRecord = { emitter: dummy, event: "test" };
      const recursiveEmitter = new RecursiveEmitter([record]);

      // Wait until RecursiveEmitter is fully ready (all subscriptions complete)
      await recursiveEmitter.ready;
      expect(recursiveEmitter.isReady).toBe(true);

      const listener = vi.fn();
      recursiveEmitter.on("test", listener);

      // Emit event on the underlying dummy emitter.
      dummy.emit("test", "payload");

      // Expect that RecursiveEmitter re-emitted the payload.
      expect(listener).toHaveBeenCalledWith("payload");
    });

    it("should re-emit an event under the alias specified by reemitAs", async () => {
      const dummy = new TestEmitter();
      const record: RecursiveEmitterRecord = {
        emitter: dummy,
        event: "original",
        reemitAs: "alias",
      };
      const recursiveEmitter = new RecursiveEmitter([record]);
      await recursiveEmitter.ready;

      const listener = vi.fn();
      recursiveEmitter.on("alias", listener);

      // Emit under the original event name.
      dummy.emit("original", 123);

      expect(listener).toHaveBeenCalledWith(123);
    });

    it("should allow subscribing to the same emitter with different events", async () => {
      const dummy = new TestEmitter();
      const record1: RecursiveEmitterRecord = { emitter: dummy, event: "event1" };
      const record2: RecursiveEmitterRecord = { emitter: dummy, event: "event2", reemitAs: "alias2" };
      const recursiveEmitter = new RecursiveEmitter([record1, record2]);
      await recursiveEmitter.ready;

      const listener1 = vi.fn();
      const listener2 = vi.fn();
      recursiveEmitter.on("event1", listener1);
      recursiveEmitter.on("alias2", listener2);

      dummy.emit("event1", "payload1");
      dummy.emit("event2", "payload2");

      expect(listener1).toHaveBeenCalledWith("payload1");
      expect(listener2).toHaveBeenCalledWith("payload2");
    });
  });  // basic event emissions



  describe('recursion', () => {
    it("should subscribe to subemitters recursively", async () => {
      // Create a subemitter that itself has no subemitters.
      const subDummy = new TestEmitter();
      // Create a parent emitter whose getSubemitters returns our subDummy.
      const parent = new TestEmitter([subDummy]);
      const record: RecursiveEmitterRecord = { emitter: parent, event: "deep" };
      const recursiveEmitter = new RecursiveEmitter([record]);
      await recursiveEmitter.ready;

      const listener = vi.fn();
      recursiveEmitter.on("deep", listener);

      // Emit an event from the parent and the sub emitter.
      parent.emit("deep", "from-parent");
      subDummy.emit("deep", "from-sub");

      expect(listener).toHaveBeenCalledWith("from-parent");
      expect(listener).toHaveBeenCalledWith("from-sub");
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it("should subscribe to multiple nested levels of subemitters", async () => {
      // Construct a chain: parent --> child --> grandchild.
      const grandchild = new TestEmitter();
      const child = new TestEmitter([grandchild]);
      const parent = new TestEmitter([child]);
      const record: RecursiveEmitterRecord = { emitter: parent, event: "multilevel" };
      const recursiveEmitter = new RecursiveEmitter([record]);
      await recursiveEmitter.ready;

      const listener = vi.fn();
      recursiveEmitter.on("multilevel", listener);

      parent.emit("multilevel", "from-parent");
      child.emit("multilevel", "from-child");
      grandchild.emit("multilevel", "from-grandchild");

      expect(listener).toHaveBeenCalledWith("from-parent");
      expect(listener).toHaveBeenCalledWith("from-child");
      expect(listener).toHaveBeenCalledWith("from-grandchild");
      expect(listener).toHaveBeenCalledTimes(3);
    });

    it("should not subscribe to subemitters beyond maxRecursiveDepth", async () => {
      const grandchild = new TestEmitter();
      const child = new TestEmitter([grandchild]);
      const parent = new TestEmitter([child]);
      // Set maxRecursiveDepth to 1 so that grandchild should be skipped.
      const record: RecursiveEmitterRecord = { emitter: parent, event: "limitTest" };
      const recursiveEmitter = new RecursiveEmitter([record], { depth: 1 });
      await recursiveEmitter.ready;

      const listener = vi.fn();
      recursiveEmitter.on("limitTest", listener);

      parent.emit("limitTest", "from-parent"); // depth 0
      child.emit("limitTest", "from-child");    // depth 1
      grandchild.emit("limitTest", "from-grandchild"); // depth 2 -- should be skipped.

      // Expected: only parent's and child's events should be re-emitted.
      expect(listener).toHaveBeenCalledWith("from-parent");
      expect(listener).toHaveBeenCalledWith("from-child");
      expect(listener).not.toHaveBeenCalledWith("from-grandchild");
      expect(listener).toHaveBeenCalledTimes(2);
    });
  });  // recursion



  describe('duplicate prevention', () => {
    it("should subscribe only once for duplicate subscriptions", async () => {
      const dummy = new TestEmitter();
      // Use the exact same record twice.
      const record: RecursiveEmitterRecord = { emitter: dummy, event: "dup" };
      const recursiveEmitter = new RecursiveEmitter([record, record]);
      await recursiveEmitter.ready;

      // Check that dummy emitter got only one listener attached.
      expect(dummy.listenerCount("dup")).toBe(1);

      const listener = vi.fn();
      recursiveEmitter.on("dup", listener);
      dummy.emit("dup", "data");

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should handle self-referential emitters without infinite recursion", async () => {
      const selfEmitter = new SelfReferencingEmitter();
      const record: RecursiveEmitterRecord = { emitter: selfEmitter, event: "loop" };
      const recursiveEmitter = new RecursiveEmitter([record]);
      await recursiveEmitter.ready;

      const listener = vi.fn();
      recursiveEmitter.on("loop", listener);

      selfEmitter.emit("loop", "circular");

      // Expect the event to be re-emitted once.
      expect(listener).toHaveBeenCalledWith("circular");
      expect(listener).toHaveBeenCalledTimes(1);
      // Underlying emitter should have one listener (the one added during subscription).
      expect(selfEmitter.listenerCount("loop")).toBe(1);
    });

    it("should subscribe only once if getSubemitters yields the same emitter twice", async () => {
      // Create a child emitter that will be yielded twice.
      const child = new TestEmitter();
      // Create a parent emitter whose getSubemitters yields duplicate references.
      const parent = new DuplicateYieldEmitter([child]);
      const record: RecursiveEmitterRecord = { emitter: parent, event: "dupSub" };
      const recursiveEmitter = new RecursiveEmitter([record]);
      await recursiveEmitter.ready;

      // Even though the generator yields the child twice, the subscription should happen once.
      expect(child.listenerCount("dupSub")).toBe(1);

      const listener = vi.fn();
      recursiveEmitter.on("dupSub", listener);
      child.emit("dupSub", "duplicate");

      expect(listener).toHaveBeenCalledWith("duplicate");
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should allow subscribing separately to the same emitter if reemitAs differs", async () => {
      const testEmitter = new TestEmitter();
      const record1: RecursiveEmitterRecord = { emitter: testEmitter, event: "dupTest" };
      const record2: RecursiveEmitterRecord = { emitter: testEmitter, event: "dupTest", reemitAs: "aliasTest" };

      // Intention: Two separate subscriptions should be installed:
      // one re-emitting under "dupTest" and one under "aliasTest".
      const recursiveEmitter = new RecursiveEmitter([record1, record2]);
      await recursiveEmitter.ready;

      const listener1 = vi.fn();
      const listener2 = vi.fn();
      recursiveEmitter.on("dupTest", listener1);
      recursiveEmitter.on("aliasTest", listener2);

      // Emit the event from the underlying emitter.
      testEmitter.emit("dupTest", "payload");

      // Expected outcome: Both listeners should capture the payload.
      expect(listener1).toHaveBeenCalledWith("payload");
      expect(listener2).toHaveBeenCalledWith("payload");
    });
  });  // duplicate prevention



  describe('shutdown', () => {
    it("should shutdown and remove subscriptions", async () => {
      const dummy = new TestEmitter();
      const record: RecursiveEmitterRecord = { emitter: dummy, event: "shutdownTest" };
      const recursiveEmitter = new RecursiveEmitter([record]);
      await recursiveEmitter.ready;

      const listener = vi.fn();
      recursiveEmitter.on("shutdownTest", listener);

      // Call shutdown and wait for its promise to resolve.
      const shutdownPromise = recursiveEmitter.shutdown();
      expect(recursiveEmitter.shuttingDown).toBe(true);
      await shutdownPromise;

      // The subscription on the underlying dummy emitter should be removed.
      expect(dummy.listenerCount("shutdownTest")).toBe(0);

      // Emitting an event after shutdown should not trigger the recursive emitter.
      dummy.emit("shutdownTest", "payload");
      expect(listener).not.toHaveBeenCalled();
    });

    it("should shutdown and remove subscriptions from nested subemitters", async () => {
      // Create a nested structure.
      const grandchild = new TestEmitter();
      const child = new TestEmitter([grandchild]);
      const parent = new TestEmitter([child]);
      const record: RecursiveEmitterRecord = { emitter: parent, event: "nestedShutdown" };
      const recursiveEmitter = new RecursiveEmitter([record]);
      await recursiveEmitter.ready;

      // Before shutdown, listeners should be attached on both parent and child.
      expect(parent.listenerCount("nestedShutdown")).toBe(1);
      expect(child.listenerCount("nestedShutdown")).toBe(1);

      await recursiveEmitter.shutdown();

      expect(parent.listenerCount("nestedShutdown")).toBe(0);
      expect(child.listenerCount("nestedShutdown")).toBe(0);
      // Also, grandchild might have been subscribed if recursion reached it.
      expect(grandchild.listenerCount("nestedShutdown")).toBe(0);
    });

    it("should allow multiple shutdown calls without error", async () => {
      const dummy = new TestEmitter();
      const record: RecursiveEmitterRecord = { emitter: dummy, event: "shutdownMultiple" };
      const recursiveEmitter = new RecursiveEmitter([record]);
      await recursiveEmitter.ready;

      // First shutdown.
      await recursiveEmitter.shutdown();
      // Subsequent shutdown calls should be safe.
      await recursiveEmitter.shutdown();

      expect(dummy.listenerCount("shutdownMultiple")).toBe(0);
    });

    it("should clear internal emitter subscriptions after shutdown", async () => {
      const testEmitter = new TestEmitter();
      const record: RecursiveEmitterRecord = { emitter: testEmitter, event: "leakTest" };
      const recursiveEmitter = new RecursiveEmitter([record]);

      // Wait until all subscriptions are done.
      await recursiveEmitter.ready;

      // Pre-condition: We expect at least one subscription to be held internally.
      expect((recursiveEmitter as any).emitters.length).toBeGreaterThan(0);

      // Shutdown should remove listeners...
      await recursiveEmitter.shutdown();
      // ...and also clear the internal subscription array to avoid lingering references.
      expect((recursiveEmitter as any).emitters.length).toBe(0);
    });
  });  // shutdown



  describe('edge cases', () => {
    it("should reject the ready promise if a subemitter's promise rejects", async () => {
      const faulty = new FaultyEmitter();
      const record: RecursiveEmitterRecord = { emitter: faulty, event: "failTest" };
      const recursiveEmitter = new RecursiveEmitter([record]);

      await expect(recursiveEmitter.ready).rejects.toThrow("Fault in subemitter");
    });
  });
});
