import { DeferredPromise } from "../../../src/core/helpers/promises";
import { DummyControllerContext } from "../../../src/webui/testingDummies";
import { VerityController } from "../../../src/webui/verityController";

import { beforeEach, describe, expect, it } from 'vitest';

async function flushAsyncSettling(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('VerityController base class, async operation tracking', () => {
  let controller: VerityController;

  beforeEach(() => {
    controller = new VerityController(new DummyControllerContext());
  });

  describe('initial state', () => {
    it('should expose no pending operations by default', async() => {
      await expect(controller.lastAsyncOp).resolves.toBeUndefined();
      await expect(controller.allAsyncOps).resolves.toEqual([]);
      expect(controller.pendingAsyncOpCount).toBe(0);
      expect(controller.pendingAsyncOps.size).toBe(0);
    });
  });

  describe('registerAsyncOp()', () => {
    it('should track a single pending operation until it settles', async() => {
      const op = new DeferredPromise<string>();

      controller.registerAsyncOp(op.promise);

      expect(controller.lastAsyncOp).toBe(op.promise);
      expect(controller.pendingAsyncOpCount).toBe(1);
      expect(Array.from(controller.pendingAsyncOps)).toEqual([op.promise]);

      const allAsyncOps = controller.allAsyncOps;
      op.resolve('done');

      await expect(controller.lastAsyncOp).resolves.toBe('done');
      await expect(allAsyncOps).resolves.toEqual(['done']);
      await flushAsyncSettling();

      expect(controller.pendingAsyncOpCount).toBe(0);
      await expect(controller.allAsyncOps).resolves.toEqual([]);
    });

    it('should keep all registered operations pending until each of them settles', async() => {
      const firstOp = new DeferredPromise<string>();
      const secondOp = new DeferredPromise<string>();

      controller.registerAsyncOp(firstOp.promise);
      controller.registerAsyncOp(secondOp.promise);

      expect(controller.lastAsyncOp).toBe(secondOp.promise);
      expect(controller.pendingAsyncOpCount).toBe(2);
      expect(Array.from(controller.pendingAsyncOps)).toEqual([firstOp.promise, secondOp.promise]);

      const allAsyncOps = controller.allAsyncOps;

      secondOp.resolve('second');
      await flushAsyncSettling();
      expect(controller.pendingAsyncOpCount).toBe(1);

      firstOp.resolve('first');

      await expect(allAsyncOps).resolves.toEqual(['first', 'second']);
      await flushAsyncSettling();

      expect(controller.pendingAsyncOpCount).toBe(0);
    });

    it('should only wait for the operations that were pending when allAsyncOps was accessed', async() => {
      const firstOp = new DeferredPromise<string>();
      const secondOp = new DeferredPromise<string>();

      controller.registerAsyncOp(firstOp.promise);
      const firstBatch = controller.allAsyncOps;

      controller.registerAsyncOp(secondOp.promise);

      firstOp.resolve('first');

      await expect(firstBatch).resolves.toEqual(['first']);
      await flushAsyncSettling();

      expect(controller.pendingAsyncOpCount).toBe(1);

      const secondBatch = controller.allAsyncOps;
      secondOp.resolve('second');

      await expect(secondBatch).resolves.toEqual(['second']);
      await flushAsyncSettling();

      expect(controller.pendingAsyncOpCount).toBe(0);
    });

    it('should expose pending operations without allowing external mutation of the internal set', async() => {
      const op = new DeferredPromise<string>();

      controller.registerAsyncOp(op.promise);

      const pendingAsyncOps = controller.pendingAsyncOps as Set<Promise<any>>;
      pendingAsyncOps.clear();

      expect(controller.pendingAsyncOpCount).toBe(1);
      expect(Array.from(controller.pendingAsyncOps)).toEqual([op.promise]);

      op.resolve('done');
      await expect(controller.allAsyncOps).resolves.toEqual(['done']);
      await flushAsyncSettling();

      expect(controller.pendingAsyncOpCount).toBe(0);
    });
  });

});
