import { CubeKey } from '../../../src/core/cube/cube.definitions';
import { CubeStore } from '../../../src/core/cube/cubeStore';

import { IdentityOptions, Identity } from '../../../src/cci/identity/identity';
import { makePost } from '../../../src/app/zw/model/zwUtil';

import { testCubeStoreParams } from '../testcci.definitions';

import sodium from 'libsodium-wrappers-sumo'
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

// TODO: Some tests here use "ZW" stuff from the microblogging app
// which breaks the current layering.

describe('Identity: static functions', () => {
  const reducedDifficulty = 0;  // no hash cash for testing
  let idTestOptions: IdentityOptions;
  let cubeStore: CubeStore;

  beforeEach(async () => {
    await sodium.ready;
    idTestOptions = {  // note that those are diferent for some tests further down
      minMucRebuildDelay: 1,  // allow updating Identity MUCs every second
      requiredDifficulty: reducedDifficulty,
      argonCpuHardness: 1,  // == crypto_pwhash_OPSLIMIT_MIN (sodium not ready)
      argonMemoryHardness: 8192, // == sodium.crypto_pwhash_MEMLIMIT_MIN (sodium not ready)
    };
    cubeStore = new CubeStore(testCubeStoreParams);
    await cubeStore.readyPromise;
  });

  describe('Create', () => {
    it('should create a valid Identity', async () => {
      const original: Identity = await Identity.Create(
        cubeStore, "usor probationis", "clavis probationis", idTestOptions);
      expect(original.masterKey).toBeInstanceOf(Buffer);
      expect(original.key).toBeInstanceOf(Buffer);
      expect(original.privateKey).toBeInstanceOf(Buffer);
      expect(original.avatar.render().length).toBeGreaterThan(20);  // SVG
    });

    // Note: This test asserts key derivation (and avatar) stability.
    // It is at full hardness in order to automatically detect
    // any inconsitencies occurring on prod settings.
    it('should be stable, i.e. always create the same Identity including the same avatar for the same user/pass combo at full hardness', async () => {
      const id: Identity = await Identity.Create(
        cubeStore, "Identitas stabilis", "Clavis stabilis", {
          identityPersistence: undefined,
          requiredDifficulty: 0,  // this is just the hashcash level,
                                  // note argon settings have not been touched
      });
      // expected derivation results
      const expectedMasterkey = "d8eabeb1ab3592fc1dfcc9434e42db8d213c5312c2e9446dcb7915c11d9d65e3";
      const expectedPubkey = "cc5fe0e80bad6db35723f578aa57c074f9bc00866fa9d206686f25f542118ce2";
      const expectedPrivkey = "8fcc6cc84f67b8e753317c6f41d0637d6d45515463e01569e61994c3b6a28765cc5fe0e80bad6db35723f578aa57c074f9bc00866fa9d206686f25f542118ce2";
      const expectedAvatar = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMzEgMjMxIj48cGF0aCBkPSJNMzMuODMsMzMuODNhMTE1LjUsMTE1LjUsMCwxLDEsMCwxNjMuMzQsMTE1LjQ5LDExNS40OSwwLDAsMSwwLTE2My4zNFoiIHN0eWxlPSJmaWxsOiMwZGY7Ii8+PHBhdGggZD0ibTExNS41IDUxLjc1YTYzLjc1IDYzLjc1IDAgMCAwLTEwLjUgMTI2LjYzdjE0LjA5YTExNS41IDExNS41IDAgMCAwLTUzLjcyOSAxOS4wMjcgMTE1LjUgMTE1LjUgMCAwIDAgMTI4LjQ2IDAgMTE1LjUgMTE1LjUgMCAwIDAtNTMuNzI5LTE5LjAyOXYtMTQuMDg0YTYzLjc1IDYzLjc1IDAgMCAwIDUzLjI1LTYyLjg4MSA2My43NSA2My43NSAwIDAgMC02My42NS02My43NSA2My43NSA2My43NSAwIDAgMC0wLjA5OTYxIDB6IiBzdHlsZT0iZmlsbDojZmZjZThiOyIvPjxwYXRoIGQ9Im05MS45MiAxOTQuNDFhMTAxLjQ3IDEwMS40NyAwIDAgMSAyMy41OCAxNy4wOSAxMDEuNDcgMTAxLjQ3IDAgMCAxIDIzLjU4LTE3LjA5YzAuODkgMC4xOSAxLjc4IDAuMzggMi42NyAwLjU5YTExNC43OSAxMTQuNzkgMCAwIDEgMzggMTYuNSAxMTUuNTMgMTE1LjUzIDAgMCAxLTEyOC40NiAwIDExNC43OSAxMTQuNzkgMCAwIDEgMzgtMTYuNWMwLjg4LTAuMjEgMS43OC0wLjQgMi42Ny0wLjU5eiIgc3R5bGU9ImZpbGw6IzcwODkxMzsiLz48cGF0aCBkPSJtNzMuNjUgMTk5LjgyYzE2LjU5IDguMjMgMjguNzIgMTguOTEgMzQuMjcgMzAuOTNhMTE0Ljg2IDExNC44NiAwIDAgMS01Ni42NS0xOS4yNSAxMTUuMDYgMTE1LjA2IDAgMCAxIDIyLjM4LTExLjY4eiIgc3R5bGU9ImZpbGw6I2ZkZWExNDsiLz48cGF0aCBkPSJtNjAuNjMgMjA1Ljg1YzEyLjM1IDUuOTQgMjEuOTMgMTMuNDQgMjcuNTkgMjEuOTFhMTE0LjcgMTE0LjcgMCAwIDEtMzYuOTUtMTYuMjZxNC41My0zIDkuMzYtNS42NXoiIHN0eWxlPSJmaWxsOiM3MDg5MTM7Ii8+PHBhdGggZD0ibTE1Ny4zNSAxOTkuODJjLTE2LjYgOC4yMy0yOC43MiAxOC45MS0zNC4yNyAzMC45M2ExMTQuODYgMTE0Ljg2IDAgMCAwIDU2LjY1LTE5LjI1IDExNS4wNiAxMTUuMDYgMCAwIDAtMjIuMzgtMTEuNjh6IiBzdHlsZT0iZmlsbDojZmRlYTE0OyIvPjxwYXRoIGQ9Im0xNzAuMzcgMjA1Ljg1Yy0xMi4zNSA1Ljk0LTIxLjkzIDEzLjQ0LTI3LjU5IDIxLjkxYTExNC43IDExNC43IDAgMCAwIDM2Ljk1LTE2LjI2cS00LjUzLTMtOS4zNi01LjY1eiIgc3R5bGU9ImZpbGw6IzcwODkxMzsiLz48cGF0aCBkPSJtMTI0LjIyIDEzLjYxYy0xOS43ODMgMC0zNi45NDUgOC4wODg3LTM5LjY5NSAyNC4xMDYtMTUuMzMyIDAuMjM1MzktMzEuODMxIDIuNzcxMi00MS42NjMgMTUuNzgyLTYuMDIzOCA3Ljk2MDQtNy4wNDAyIDE5LjkwMS02Ljg0NzYgMzEuNzI0IDAuNDYwMDcgMjguNTAzIDEwLjc0MiA2NC4yMjgtNC4zMDEyIDg5LjcxNCAxNi41ODQgNS43Nzc3IDQzLjA4NiAxMC43NDIgNzMuNTkgMTEuNjYydi04LjY1NThjLTEuODUxLTAuMzUzMDgtMy42NTkyLTAuNzgxMDUtNS40MzUzLTEuMjczMi0zMC45NTMtOC40NjMyLTUwLjY3Mi0zNi42MzUtNDcuMjU5LTY4LjY2OSAxLjU1MTQtMTAuNjAzIDQuNjIyMS0xOS42NjUgMTAuMDI1LTI3LjY5IDUuMzgxOC03Ljk5MjUgMTMuMjY3LTE1LjcxNyAyMy44OTItMjEuNDEgMC40MDY1OCAwLjcyNzU3IDEuOTkwMSAzLjU4NDMgMi40MDc0IDQuMzAxMiA3LjUwMDMgMTIuNzc1IDE3Ljk4NiAyMy44NDkgMzMuMTU3IDI2Ljg2NiAxMi40MzMgMi40NjA5IDIzLjg0OSAzLjQ2NjYgMzYuMzQ2IDEuMTU1NSA0LjI1ODQtMC43ODEwNiAxMC42NjctMi4zOTY3IDE0Ljg1MS0yLjQxODEgMTQuODYxIDMzLjQwNC0xLjA4MDYgNzUuMDM1LTQwLjY2OCA4Ny40NTctMi4yMjU1IDAuNzA2MTYtNC41MjU4IDEuMzE2LTYuODkwNCAxLjgxODkgMCAyLjcwNy0wLjA0MjggNS42NDkzLTAuMDY0MiA4LjUyNzQgMjMuNjAzLTAuNzI3NTcgNDguNjgyLTQuMDQ0NCA3Mi44NzQtMTEuMjM0LTE4LjUyMS0zMi4xNTIgMC44MTMxNS04OS4wODMtMTAuMDM2LTEyMS40Ni05LjA3MzEtMjYuOTczLTM4Ljg1LTQwLjMxNS02NC4yODItNDAuMzA1eiIgc3R5bGU9ImZpbGw6IzAwMDsiLz48cGF0aCBkPSJtMzMuMTQ3IDE3Mi4zMmMtMi42NTM1IDUuMTE0My02LjA4OCA5Ljk1MDQtMTAuMSAxMi40MTEgNy44NDI3IDEwLjQ1MyAxNy4zODcgMTkuNTE2IDI4LjI1NyAyNi43ODEgMTYuMDM4LTEwLjczMSAzNS42MjktMTcuMDU1IDU0LTE4LjYwNnYtOS4wMDg5Yy0zMC4wNjUtMC45NDE1NS01Ni4xMDgtNS44ODQ3LTcyLjE1Ny0xMS41Nzd6bTE2NC4wNiAwLjU1NjM3Yy0yMy43MzEgNy4wNzIzLTQ4LjM2MSAxMC4zMjUtNzEuNTI1IDExLjA0Mi0wLjAzMjEgMy4xMjQyLTAuMDUzNSA2LjIzNzctMC4wMTA3IDkuMDUxNyAxOS4yMjcgMS43MjI2IDM3LjkwOCA3Ljg1MzQgNTMuOTg5IDE4LjU0MiAwLjAxMDcgMCAwLjAxMDcgMCAwLjAyMTQgMC4wMTA3IDEwLjczMS03LjE2ODYgMjAuMTc5LTE2LjA4MSAyNy45NTgtMjYuMzc0LTQuMjc5OC0yLjM5NjctNy44MzItNi45NjUzLTEwLjQzMi0xMi4yNzJ6IiBzdHlsZT0iZmlsbDpub25lOyIvPjxwYXRoIGQ9Im01MC4wMiA0Ni41Yy0yLjkyOTcgMS45MTQzLTYuMTMxMyAzLjg4MjYtMTAuMTU0IDcuOTgwNS0xNC4wOTEgMTQuMzU5LTE2LjE0NSAyNy43MDEtNi4xNDA2IDQ0LjAxOCA0LjIwNDkgNi44NTgzIDYuMTQxNCAxMy43MDYtMC4yNDYwOSAyMC41LTcuNzE0MyA4LjE5NTctMjEuNTU5IDQuMjkxMi0yMS41MzcgMTYuMDYxIDAuMDIxNCA4LjYxMyAxNS4wNjMgNy45MTc4IDIyLjUzMSAxMy45ODQgMy43NjYyIDMuMDcwNyA1LjA4MzYgOC4zOTkyIDIuMDY2NCAxMi41MDgtNC4yMTU2IDUuNzQ1Ni0xNi4wMDYgNy4zNzE1LTIyLjYyOSA4LjkzMzYgNS44ODExIDEwLjg0MyAxMy40NSAyMC42MzggMjIuMzU1IDI5LjAzM2wwLjAwMzkgMC4wMjM0IDAuMDA1OS0wLjAxMzdjMmUtMyAyZS0zIDAuMDAzOCA0ZS0zIDAuMDA1OSA2ZS0zIDAuMDAzNC0wLjAxMTIgMC4wMDYzLTAuMDIxOSAwLjAwOTgtMC4wMzMyIDE0Ljc3NS0xMi4yMTggMjAuMjY4LTIwLjk2NSA0OS40NjEtMjguNDM0LTE3LjQwNC0xMC4yNTgtMzAuNjgtMjcuMTIyLTI0LjE0My0zNS4zNCA0LjQxMjMtNS41NDQ0IDUuNjYxMi03Ljg2MzMgNi40MDYyLTEyLjA3OCAyLjM1ODItMTMuMzM5LTEwLjIwOC0yMi4zMzUtOS4yMzYzLTMyLjcxNSAxLjk0MzItOC4yMzQ2IDExLjM3OS0xMS4xNzMgMTYuOTQ3LTE1LjExNSA1LjQ1NzctMy45MDgyIDkuODAxNC04Ljc2OTUgMTAuNzk5LTE2LjkxOC0xMy41NTgtNC44ODk2LTE3LjYwOS01Ljg2MTctMzYuNTA2LTEyLjR6bTE0MC44NyAxOS4zNTdjLTMuNDQwNC0wLjkxMjQzLTIzLjMxMSAxMjIuNDMgNC40MTIxIDEzMy4xNCA4Ljk2NjEtOC41ODA5IDE2LjU1Mi0xOC41ODQgMjIuNDA0LTI5LjY1OCAwLTAuMzEwMjktMjUuMTMzLTMuOTkyMi0yNS45NzktMTQuMDE4LTAuMTA2OTktMS4xNzY5IDAuMTE4MjItMS40ODU1IDAuODY3MTgtMi41MDIgNi42NzY0LTkuMjEyMiAzMC43MTYtMTEuNDE2IDI5LjY0Ni0yMy40OTYtMC4yNzgxOC0zLjE1NjMtNC4xNjE3LTUuMjMzNC02Ljc0MDItNi40NTMxLTEyLjE1NS01Ljc2Ny0zMi45NDItOS42NDk0LTE1LjAzMS0yNC41NDMgOS4yMTIyLTcuMzUwNSAxMC40My04LjQzMjMgMC41OTc2Ni0xNC42OTEtOS40NTgzLTYuMDIzOC05LjM5NC0xMS45OTMtOS43NTc4LTE2LjMyNi0wLjA3NjctMC45MzAzNS0wLjIyMDg5LTEuNDAwMy0wLjQxOTkyLTEuNDUzMXoiIHN0eWxlPSJmaWxsOm5vbmU7Ii8+PHBhdGggZD0ibTEzMy44MyAzOS45MDljLTExLjMzIDEuMzkzLTkuNTQ5MiAxNi4yMDQtMmUtMyAxNi42NDMtNC41MTAyIDEwLjcxNyA5LjAxNjUgMTYuMTgxIDE0LjQ0MSA4LjMxMjUgNi41NjIgOC42NzY1IDE4LjU5NiAwLjk0NzUxIDE0LjQ1Ny04LjMxMjUgMTEuNzE4LTEuNTM4MSA5LjI3NjktMTYuMDk5IDAtMTYuNjQzIDQuNTAzLTEwLjg2Ny05LjQ4ODMtMTYuMTAxLTE0LjQ1Ny04LjMzMDEtNi44ODMyLTkuMDQxMS0xOC41MDktMC40NzMyMS0xNC40MzkgOC4zMzAxeiIgc3R5bGU9ImZpbGw6I0ZGQ0MwMDsiLz48cGF0aCBkPSJtMTUzLjg2IDQ4LjIyMmMwLTMuMDUyOC0yLjUxODQtNS41NjQ4LTUuNTc5MS01LjU2NDgtMy4wNzgzIDAtNS41NzkzIDIuNTEyLTUuNTc5MyA1LjU2NDggMCAzLjA3MDMgMi41MDEgNS41NjQ4IDUuNTc5MyA1LjU2NDggMy4wNjA2IDAgNS41NzkxLTIuNDk0NiA1LjU3OTEtNS41NjQ4eiIgc3R5bGU9ImZpbGw6cmVkOyIvPjxwYXRoIGQ9Im03OC43MyAxMTFhMTAuOSAxMC45IDAgMCAxIDE1LjE5IDBtNDMuMTYgMGExMC45IDEwLjkgMCAwIDEgMTUuMTkgMCIgc3R5bGU9ImZpbGw6bm9uZTtzdHJva2UtbGluZWNhcDpyb3VuZDtzdHJva2UtbGluZWpvaW46cm91bmQ7c3Ryb2tlLXdpZHRoOjYuMTk5OXB4O3N0cm9rZTojMDAwOyIvPjxwYXRoIGQ9Im03OS44MDQgMTIzLjc0aDcuMDdtNTcuMjczIDBoNy4wNSIgc3R5bGU9ImZpbGw6bm9uZTtzdHJva2UtbGluZWNhcDpyb3VuZDtzdHJva2UtbGluZWpvaW46cm91bmQ7c3Ryb2tlLXdpZHRoOjUuOTk5OHB4O3N0cm9rZTojMDA3MmZmOyIvPjxwYXRoIGQ9Im0xMjIuODMgMTUxLjg4YTEwLjQ5IDEwLjQ4OSAwIDAgMS0xNC42NiAwIiBzdHlsZT0iZmlsbDpub25lO3N0cm9rZS1saW5lY2FwOnJvdW5kO3N0cm9rZS1saW5lam9pbjpyb3VuZDtzdHJva2Utd2lkdGg6Ni4xOTk2cHg7c3Ryb2tlOiMwMDA7Ii8+PC9zdmc+";
      // logger.trace("Masterkey: " + id.masterKey.toString('hex'));
      // logger.trace("Pubkey: " + id.muc.publicKey.toString('hex'));
      // logger.trace("Privkey: " + id.muc.privateKey.toString('hex'));
      // logger.trace("Avatar: " + id.avatar.render());
      expect(id.masterKey.toString('hex')).toEqual(expectedMasterkey);
      expect(id.muc.publicKey.toString('hex')).toEqual(expectedPubkey);
      expect(id.muc.privateKey.toString('hex')).toEqual(expectedPrivkey);
      expect(id.avatar.render()).toEqual(expectedAvatar);
    });
  });

  describe("Load", () => {
    it("returns undefined when MUC is unavailable", () => {
      const doesNotExist = Identity.Load(cubeStore, "Usor absens",
        "quis curat de clavis usoris non existentis?");
      expect(doesNotExist).toBeUndefined;
    });

    it('correctly restores an existing Identity', async () => {
      // create an Identity
      const original: Identity = await Identity.Create(
        cubeStore, "usor probationis", "clavis probationis", idTestOptions);
      // make lots of custom changes
      original.name = "Sum usor frequens, semper redeo"
      original.avatar.random();

      // make a post
      expect(original.getPostCount()).toEqual(0);
      const post = await makePost("Habeo res importantes dicere",
        { id: original, requiredDifficulty: reducedDifficulty });
      await cubeStore.addCube(post);
      expect(original.getPostCount()).toEqual(1);

      // remember individual values and customizations
      const masterkey = original.masterKey.toString('hex');
      const pubkey = original.muc.publicKey.toString('hex');
      const privkey = original.muc.privateKey.toString('hex');
      const chosenAvatar: string = original.avatar.seedString;
      const myPostKey: CubeKey = original.getPostKeyStrings()[0];

      // store Identity
      await original.store();

      // restore Identity
      const restored: Identity = await Identity.Load(cubeStore,
        "usor probationis", "clavis probationis", idTestOptions);

      // assert all values custom changes still present
      expect(restored.name).toEqual("Sum usor frequens, semper redeo");
      expect(restored.masterKey.toString('hex')).toEqual(masterkey);
      expect(restored.muc.publicKey.toString('hex')).toEqual(pubkey);
      expect(restored.muc.privateKey.toString('hex')).toEqual(privkey);
      expect(restored.avatar.seedString).toEqual(chosenAvatar);
      expect(restored.getPostCount()).toEqual(1);
      expect(restored.getPostKeyStrings()[0]).toEqual(myPostKey);
    });
  });
});  // static helpers
