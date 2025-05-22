import { IdentityOptions } from "../../cci/identity/identity.definitions";
import { Identity } from "../../cci/identity/identity";
import { IdentityPersistence, IdentityPersistenceOptions } from "../../cci/identity/identityPersistence";

import { EditIdentityView } from "./editIdentityView";
import { LoginFormView } from "./loginFormView";
import { LoginStatusView } from "./loginStatusView";
import { ControllerContext, VerityController, VerityControllerOptions } from "../verityController";

import { Avatar, AvatarScheme } from "../../cci/identity/avatar";

export class IdentityController extends VerityController {
  declare options: IdentityOptions&IdentityPersistenceOptions&VerityControllerOptions;
  loginStatusView: LoginStatusView;

  private _identity: Identity = undefined;
  get identity(): Identity { return this._identity}
  set identity(identity: Identity) {
    this._identity = identity;
    this.showLoginStatus();
  }

  get persistence(): IdentityPersistence { return this.options.identityPersistence || undefined }

  constructor(
    parent: ControllerContext,
    options: IdentityOptions&IdentityPersistenceOptions&VerityControllerOptions = {},
  ){
    super(parent, options);
    if (options.identityPersistence === undefined) {
      options.identityPersistence = new IdentityPersistence(options);
    }
    this.loginStatusView = new LoginStatusView(this);
    this.showLoginStatus();
  }

  //***
  // View selection methods
  //***
  selectLoginForm(): Promise<void> {
    this.contentAreaView = new LoginFormView(this);
    return new Promise<void>(resolve => resolve());  // nothing to do, return resolved promise
  }

  selectEditForm(): Promise<void> {
    this.contentAreaView = new EditIdentityView(this);
    return new Promise<void>(resolve => resolve());  // nothing to do, return resolved promise
  }


  //***
  // View assembly methods
  //***

  showLoginStatus() {
    if (this._identity) this.loginStatusView.renderLoggedIn(this._identity);
    else this.loginStatusView.renderLoggedOut();
  }


  //***
  // Navigation methods
  //***

  /**
   * Handle a traditional username/password login
   * Called from: login form view
   * Submit method.
   */
  async performPasswordLogin(form: HTMLFormElement) {
    this.contentAreaView.clearAlerts();

    const username: string =
      (form.querySelector(".verityLoginUsernameInput") as HTMLInputElement).value;
    const password: string =
      (form.querySelector(".verityLoginPasswordInput") as HTMLInputElement).value;
    // TODO: enforce some minimum length for both
    let identity: Identity = await Identity.Load(this.node.veritumRetriever, {
      ...this.options,
      username, password,
      // Block app for up to one second trying to fetch existing Identity.
      // If not successful, Identity will be constructed empty and may later
      // adopt the existing root Cube as it arrives.
      timeout: 1000,
    });
    // TODO provide proper feedback if login fails; just constructing a new Identity on e.g. a network error or a type is a very confusing user experience
    if (identity === undefined) {
      identity = await Identity.Create(
        this.veritumRetriever, username, password, this.options);
      identity.name = username;  // TODO separate username and display name
    }
    // @ts-ignore Typescript does not know the PasswordCredential DOM API
    // TODO: This just doesn't work in Chrome.
    // And Firefox is smart enough to offer autocomplete without it anyway.
    if (window.PasswordCredential) {
    // @ts-ignore Typescript does not know the PasswordCredential DOM API
      const passwordCredential = new PasswordCredential({
        // iconURL: "vera.svg",  -- need full URL
        id: username,
        name: identity.name,
        password: password,
        origin: window?.location?.origin,
      });
      window?.navigator?.credentials?.store?.(passwordCredential);
    }
    return this.finaliseLogin(identity);
  }


  /**
   * Handle a bip39 recovery phrase login
   * Called from: login form view
   * Submit method.
   */
  async performBip39Login(form: HTMLFormElement) {
    this.contentAreaView.clearAlerts();

    const recoveryPhrase: string =
      (form.querySelector(".verityLoginBip39Input") as HTMLInputElement).value;
    let identity: Identity = await Identity.Load(this.node.veritumRetriever, {
      ...this.options,
      recoveryPhrase,
      // Block app for up to one second trying to fetch existing Identity.
      // If not successful, will show an error.
      // TODO give immediate feedback, then allow much more time for background retrieval
      timeout: 1000,
    });
    if (identity === undefined) {
      this.contentAreaView.makeAlert(
        "Could not find an Identity for this recovery phrase.", {
          container: ".verityLoginFormBip39ErrorMessage",
          type: "danger",
      });
      return;
    }
    return this.finaliseLogin(identity);
  }

  /**
   * Called from: login status view
   * Logs the current user out.
   */
  async logOut(): Promise<void> {
    // TODO: handle the various Identites we may have in our local Identity DB
    // sensibly. Either expose them as various locally saved accounts, or just
    // delete them on logout, or whatever. But do something!
    this._identity = undefined;
    await this.parent.nav.identityChanged();
    this.showLoginStatus();
    // TODO: we should show the user some promts asking them whether they're
    // sure and stuff -- and most importantly, reminding them that they will
    // not be able to log back in if they ever forget their password
  }

  /**
   * Called from: edit identity form
   * Submit method.
   */
  performEditIdentity(form: HTMLFormElement) {
    // TODO input validation
    const displayname: string = ((form.querySelector(
      ".verityDisplayNameInput")) as HTMLInputElement).value;
    this._identity.name = displayname;
    const avatarSeed: string = ((form.querySelector(
      ".verityEditIdentityAvatarSeed")) as HTMLInputElement).value;
    if (avatarSeed?.length) {
      this._identity.avatar = new Avatar(avatarSeed, AvatarScheme.MULTIAVATAR);
    }
    this._identity.store();
    this.showLoginStatus();
    this.close();
  }

  /**
   * Called from: edit identity form
   * Creates a new random multiavatar for the user.
   **/
  randomMultiavatar() {
    if (!(this.contentAreaView instanceof EditIdentityView)) return;
    const randomAvatar = new Avatar(true);
    this.contentAreaView.displayAvatar(randomAvatar.seedString, randomAvatar.render());
  }


  //***
  // Business logic invocation methods
  //***
  async loadLocal(): Promise<boolean> {
    const idlist: Identity[] = await Identity.Retrieve(this.veritumRetriever, this.options);
    let identity: Identity = undefined;
    if (idlist?.length) identity = idlist[0];
    this.showLoginStatus();
    if (identity) {
      this.identity = identity;
      return true;
    } else return false;
  }


  //***
  // Framework event handling
  //***

  async identityChanged(): Promise<boolean> {
    // Identity controller must ignore its own identityChanged events
    // as it is the very instance causing them.
    return true;
  }


  private async finaliseLogin(identity: Identity): Promise<void> {
    // If we're using Identity persistence, store the logged in Identity persistently.
    // Don't use identity.store() to avoid recompiling it.
    identity.persistance?.store?.(identity);

    // Set this Identity as the currently logged in one
    this._identity = identity;

    // Update the view
    this.showLoginStatus();

    // Inform our controllers that the identity has changed
    // (which will reload them unless they handle the event internally)
    await this.parent.nav.identityChanged();

    // Close the login form
    this.close();
  }
}
