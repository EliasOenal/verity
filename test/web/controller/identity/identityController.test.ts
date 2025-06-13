import { Identity } from "../../../../src/cci/identity/identity";
import { IdentityController, IdentityControllerOptions } from "../../../../src/webui/identity/identityController";
import { DummyControllerContext } from "../../../../src/webui/testingDummies";

import { testCciOptions } from "../../../cci/testcci.definitions";

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('IdentityController', () => {

  describe('constructor()', () => {
    describe('initialisation', () => {
      it('should set its controller context', () => {
        const context = new DummyControllerContext();
        expect(context.identityController.parent).toBe(context);
      });
    });

    describe('automatic login', () => {
      describe('feature disabled', () => {
        it('should do nothing if feature disabled', async() => {
          const context = new DummyControllerContext({
            ...testCciOptions,
            identityPersistence: false,
            autoCreateIdentity: false,
          });
          await context.identityController.ready;

          expect(context.identityController.identity).toBeUndefined();
        });
      });

      describe('auto-create new Identity', () => {
        it('should create a new Identity if feature enabled', async() => {
          const autoCreateAccountDisplayname = 'Usarius experimentalis non permanens';
          const context = new DummyControllerContext({
            ...testCciOptions,
            identityPersistence: false,
            autoCreateIdentity: true,
            autoCreateIdentityName: autoCreateAccountDisplayname,
          });
          await context.identityController.ready;

          expect(context.identityController.identity).toBeInstanceOf(Identity);
          expect(context.identityController.identity.name).toBe(autoCreateAccountDisplayname);
        });
      });

      // Need to make IdentityPersistence testable for this, i.e. either mock it
      // or allow it to work with an in-memory LevelDB.
      describe.todo('auto log in to persisted identity');
    });
  });

});
