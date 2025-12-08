import { Cockpit, VerityField, VerityNode } from "../../../src";
import { makePost } from "../../../src/app/zw/model/zwUtil";
import { cciCube } from "../../../src/cci/cube/cciCube";
import { CrpytographyError } from "../../../src/cci/helpers/cryptography";
import { Identity } from "../../../src/cci/identity/identity";
import { IdentityOptions } from "../../../src/cci/identity/identity.definitions";
import { CubeStore } from "../../../src/core/cube/cubeStore";

import { testCubeStoreParams, idTestOptions, testCciOptions } from "../testcci.definitions";

import sodium from 'libsodium-wrappers-sumo'
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('Identity (login workflow tests)', () => {
  let node: VerityNode;
  let cockpit: Cockpit;

  beforeAll(async () => {
    await sodium.ready;
    node = await VerityNode.Create(testCciOptions);
  });

  const defaultOptions: IdentityOptions = idTestOptions;
  const differentContext: IdentityOptions = {
    ...idTestOptions,
    idmucContextString: "aliud omnino diversum",
    idmucApplicationString: "applicatio alia",
  };

  describe('creating an Identity through username/password, and logging back in again', () => {
    let original: Identity;

    const username = "usor probationis";
    const password = "clavis probationis";

    const screenName = "Usor probationis sum";

    for (const [desc,  options] of [
      ["default options", defaultOptions],
      ["different application context", differentContext],
    ] as [string, IdentityOptions][]) {
      describe(desc, () => {
        beforeAll(async () => {
          // Create an Identity
          original = await Identity.Create(
            node.cubeRetriever, username, password, idTestOptions);
          // and a Cockpit for it
          cockpit = new Cockpit(node, {
            identity: original,
          });
          // Set a name and make a post
          original.name = screenName;
          await cockpit.publishVeritum({
            fields: VerityField.Payload("Habeo res importantes dicere"),
            requiredDifficulty: 0,
          });
        });

        it('should be able to log in again', async () => {
          const restored = await Identity.Load(node.cubeRetriever, {
            ...idTestOptions,
            username, password,
          });
          expect(restored).toBeInstanceOf(Identity);
          expect(restored.masterKey.equals(original.masterKey)).toBe(true);
          expect(restored.publicKey.equals(original.publicKey)).toBe(true);
          expect(restored.privateKey.equals(original.privateKey)).toBe(true);

          expect(restored.name).toEqual(screenName);
          expect(restored.getPostCount()).toEqual(1);
          expect(restored.getPostKeyStrings()[0]).toEqual(original.getPostKeyStrings()[0]);
        });  // it should be able to log in again
      });  // describe block for [desc,  options]
    }  // for [desc,  options]
  });  // creating an Identity through username/password and logging back in again
});
