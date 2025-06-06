import { Identity } from "../../../../src/cci/identity/identity";
import { IdentityController, IdentityControllerOptions } from "../../../../src/webui/identity/identityController";
import { DummyControllerContext } from "../../../../src/webui/testingDummies";

import { testCciOptions } from "../../../cci/testcci.definitions";

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('IdentityController', () => {
  let identityController: IdentityController;

  const options: IdentityControllerOptions = {
    ...testCciOptions,
    identityPersistence: false,
    loginStatusView: false,  // this is a non-UI test
  }


  describe('constructor()', () => {
    describe('initialisation', () => {
      const context = new DummyControllerContext();
      const identityController: IdentityController =
        new IdentityController(context, options);

      it('should set its controller context', () => {
        expect(identityController.parent).toBe(context);
      });
    });

    describe('automatic login', () => {
      describe('feature disabled', () => {
        it('should do nothing if feature disabled', async() => {
          identityController = new IdentityController(new DummyControllerContext(), {
            ...options,
            identityPersistence: false,
            autoCreateIdentity: false,
          });
          await identityController.ready;

          expect(identityController.identity).toBeUndefined();
        });
      });

      describe('auto-create new Identity', () => {
        it('should create a new Identity if feature enabled', async() => {
          const autoCreateAccountDisplayname = 'Usarius experimentalis non permanens';
          identityController = new IdentityController(new DummyControllerContext(), {
            ...options,
            identityPersistence: false,
            autoCreateIdentity: true,
            autoCreateIdentityName: autoCreateAccountDisplayname,
          });
          await identityController.ready;

          expect(identityController.identity).toBeInstanceOf(Identity);
          expect(identityController.identity.name).toBe(autoCreateAccountDisplayname);
        });
      });

      // Need to make IdentityPersistence testable for this, i.e. either mock it
      // or allow it to work with an in-memory LevelDB.
      describe.todo('auto log in to persisted identity');
    });
  });

});
