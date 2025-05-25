// @vitest-environment jsdom

import { VerityError } from '../../../../src/core/settings';
import { DummyNetworkManager } from '../../../../src/core/networking/testingDummies/dummyNetworkManager';
import { PeerDB } from '../../../../src/core/peering/peerDB';
import { CubeStore } from '../../../../src/core/cube/cubeStore';

import { testCciOptions } from "../../../cci/testcci.definitions";
import { loadVerityBaseTemplate } from '../uiTestSetup';

import { VerityOptions, VerityUI } from '../../../../src/webui/verityUI';

import { Buffer } from 'buffer';
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

const testOptions: VerityOptions = {
  ...testCciOptions,
  requestTimeout: 100,
  startupAnimation: false,  // uses features not present in JSDOM
}

// Note! These are workflow tests.
// You cannot run them in isolation or skip any essential steps.

describe('Login/Logout flow UI tests', () => {
  let verity: VerityUI;

  const username = 'usor probationis';
  const password = 'clavis probationis';
  let recoveryPhrase: string;

  beforeAll(async () => {
    await loadVerityBaseTemplate();  // initialise DOM

    // construct UI using a dummy node (no network communication)
    const cubeStore = new CubeStore(testOptions);
    const peerDB = new PeerDB();
    const dummyNetworkManager = new DummyNetworkManager(cubeStore, peerDB, testOptions);
    verity = await VerityUI.Construct({
      ...testOptions,
      cubeStore, peerDB,
      networkManager: dummyNetworkManager,
    });
  });

  describe('verify test setup', () => {
    it('uses regular UInt8Array-based Buffers and not whatever crap JSDOM tries to inject', () => {
      const testBuf = Buffer.alloc(10, 42);
      expect(testBuf).toBeInstanceOf(Uint8Array);
      expect(Buffer.isBuffer(testBuf)).toBe(true);
    });
  });

  describe('LoginStatusView initial (logged out) state', () => {
    it('should show the log in link', () => {
      const loginA: HTMLElement = document.querySelector('.verityIdentityLoginLink')!;
      expect(loginA).not.toBeNull();
    });

    it('should display the unknown user avatar', () => {
      // should show the avatar
      const avatar: HTMLImageElement = document.querySelector('.verityIdentityAvatar')!;
      expect(avatar).not.toBeNull();
      expect(avatar.src).toContain("unknownuser.svg");
    });

    it('should NOT show the log out link', async () => {
      const logoutLink: HTMLElement = document.querySelector('.verityIdentityLogoutLink')!;
      expect(logoutLink).toBeNull();
    });

    it('should NOT show the profile edit link', () => {
      const profileEditLink: HTMLElement = document.querySelector('.verityIdentityEditLink')!;
      expect(profileEditLink).toBeNull();
    });

    it('should NOT show any username', () => {
      const usernameDisplay: HTMLElement = document.querySelector('.verityIdentityDisplayname')!;
      expect(usernameDisplay).toBeNull();
    });
  });

  // Login and registration still not separated
  describe.todo('account registration');

  describe('password log in', () => {
    it('should show the password-based log in form', async () => {
      // open the form
      const loginLink: HTMLElement = document.querySelector('.verityIdentityLoginLink')!;
      loginLink.click();
      await new Promise(resolve => setTimeout(resolve, 0));  // yield control

      // should show the form
      const form: HTMLFormElement = document.querySelector('.verityLoginPasswordForm')!;
      expect(form).not.toBeNull();

      // should show username/password input as well as the submit button
      const usernameInput: HTMLInputElement = form.querySelector('.verityLoginUsernameInput')!;
      expect(usernameInput).not.toBeNull();

      const passwordInput: HTMLInputElement = form.querySelector('.verityLoginPasswordInput')!;
      expect(passwordInput).not.toBeNull();

      const submitButton: HTMLButtonElement = form.querySelector('.verityLoginPasswordSubmitButton')!;
      expect(submitButton).not.toBeNull();
    });

    // since login and registration are not yet separated, failed log ins are
    // by definition impossible
    it.todo('failed log in');

    it('successful login', async () => {
      // enter username and password
      const usernameInput: HTMLInputElement = document.querySelector('.verityLoginUsernameInput')!;
      usernameInput.value = username;
      usernameInput.dispatchEvent(new Event('input'));
      const passwordInput: HTMLInputElement = document.querySelector('.verityLoginPasswordInput')!;
      passwordInput.value = password;
      passwordInput.dispatchEvent(new Event('input'));

      // submit
      const submitButton: HTMLButtonElement = document.querySelector('.verityLoginPasswordSubmitButton')!;
      submitButton.click();

      // TODO as login and registration are not separated yet,
      // we currently wait a fixed 1000ms trying to fetch an existing identity
      // before proceeding to create a new one
      await new Promise(resolve => setTimeout(resolve, 2000));

      // verify logged in
      expect(window.verity.identity).toBeDefined();
      expect(window.verity.identity.name).toEqual(username);

      // HACKHACK store this Identity for later test
      await window.verity.identity.store();
      // HACKHACK remember recovery phrase for later test
      recoveryPhrase = window.verity.identity.recoveryPhrase;
    }, 10000);
  });

  describe('IdentityStatusView in logged in state', () => {
    it('should show the log out link', async () => {
      const logoutLink: HTMLElement = document.querySelector('.verityIdentityLogoutLink')!;
      expect(logoutLink).not.toBeNull();
    });

    it('should show the profile edit link', () => {
      const profileEditLink: HTMLElement = document.querySelector('.verityIdentityEditLink')!;
      expect(profileEditLink).not.toBeNull();
    });

    it('should show the username', () => {
      const usernameDisplay: HTMLElement = document.querySelector('.verityIdentityDisplayname')!;
      expect(usernameDisplay).not.toBeNull();
      expect(usernameDisplay.textContent).toBe(username);
    });

    it('should show the avatar', () => {
      // should show the avatar
      const avatar: HTMLImageElement = document.querySelector('.verityIdentityAvatar')!;
      expect(avatar).not.toBeNull();
      expect(avatar.src).toContain(window.verity.identity.avatar.render());
    });

    it('should NOT show the log in link', () => {
      const loginA: HTMLElement = document.querySelector('.verityIdentityLoginLink')!;
      expect(loginA).toBeNull();
    });
  });


  describe('log out', () => {
    // Note: Log outs are currently instantaneous once you click log out.
    //   This is not a good idea as it makes it easy to permanently lose account
    //   access, especially for passwordless accounts (once implemented). We should show a log out
    //   view instead, print some warnings, maybe re-offer the recovery code and QR code (once implemented),
    //   and/or re-offer creating a passkey (once implemented),
    //   and most importantly ask for logout confirmation.

    beforeAll(async () => {
      // open the form
      const logoutLink: HTMLElement = document.querySelector('.verityIdentityLogoutLink')!;
      logoutLink.click();
      await new Promise(resolve => setTimeout(resolve, 0));  // yield control
    });

    it('should perform the log out', () => {
      expect(window.verity.identity).toBeUndefined();
    });

    it('should re-show the login link after logging out', () => {
      const loginA: HTMLElement = document.querySelector('.verityIdentityLoginLink')!;
      expect(loginA).not.toBeNull();
    });
  });

  describe('bip39 recovery phrase login', () => {
    it('should show the bip39 recovery phrase login form', async () => {
      // open the form
      const loginLink: HTMLElement = document.querySelector('.verityIdentityLoginLink')!;
      loginLink.click();
      await new Promise(resolve => setTimeout(resolve, 0));  // yield control

      const bip39LoginForm: HTMLElement = document.querySelector('.verityLoginBip39Form')!;
      expect(bip39LoginForm).not.toBeNull();
    });

    it.todo('unsuccessful recovery phrase login');

    it('should perform the bip39 recovery phrase login', async () => {
      if (!recoveryPhrase!) throw new VerityError("Cannot run the bip39 recovery phrase login test in isolation, recovery phrase is fetched during the password log in test!");

      // enter recovery phrase
      const bip39Input: HTMLInputElement = document.querySelector('.verityLoginBip39Input')!;
      bip39Input.value = recoveryPhrase!;
      bip39Input.dispatchEvent(new Event('input'));

      // submit
      const submitButton: HTMLButtonElement = document.querySelector('.verityLoginBip39SubmitButton')!;
      submitButton.click();

      await new Promise(resolve => setTimeout(resolve, 100));  // yield control

      // verify logged in
      expect(window.verity.identity).toBeDefined();
      expect(window.verity.identity.name).toEqual(username);
    });
  });
});