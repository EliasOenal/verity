import { IdentityOptions } from "../../cci/identity/identity.definitions";
import { Identity } from "../../cci/identity/identity";
import { IdentityPersistence, IdentityPersistenceOptions } from "../../cci/identity/identityPersistence";
import { Avatar, AvatarScheme } from "../../cci/identity/avatar";
import { IdentityStore } from "../../cci/identity/identityStore";

import * as WebuiSettings from "../webuiSettings";
import { VerityView } from "../verityView";
import { EditIdentityView } from "./editIdentityView";
import { LoginFormView } from "./loginFormView";
import { LoginStatusView } from "./loginStatusView";
import { ControllerContext, VerityController, VerityControllerOptions } from "../verityController";


import sodium from 'libsodium-wrappers-sumo';

export interface IdentityControllerOptions
    extends IdentityOptions, IdentityPersistenceOptions, VerityControllerOptions
{
  /**
   * If enabled, a new passwordless account will be created automatically
   * on launch (unless an existing locally persistent Identity was loaded).
   */
  autoCreateIdentity?: boolean;

  /**
   * The display name to use when auto-creating a new account.
   * @default - New User
   */
  autoCreateIdentityName?: string;

  /**
   * This options allows to override the default login status view.
   * Used mainly for testing. You probably won't want to use this.
   **/
  loginStatusView?: VerityView | typeof VerityView | false;
}


export class IdentityController extends VerityController {
  declare options: IdentityControllerOptions;
  loginStatusView: LoginStatusView;

  private _identity: Identity = undefined;
  get identity(): Identity { return this._identity}
  set identity(identity: Identity) {
    this._identity = identity;
    this.showLoginStatus();
  }

  /**
   * A promise that resolves when the IdentityController is fully ready.
   * This is only relevant in case of an automatic log in, in which case this
   * promise will resolve when the login has been processed.
   * (Note: Having processed the log in does does not
   * indicate that the Identity has been fully parsed, as there is never any
   * guarantee on how long fully parsing an Identity will take or if it will
   * even succeed at all.
   * The logged in Identity can still be used regardless and additional content
   * [posts, subscriptions, etc.] will be loaded in the background.)
   */
  ready: Promise<void>;

  get persistence(): IdentityPersistence { return this.options.identityPersistence || undefined }

  constructor(
    parent: ControllerContext,
    options: IdentityControllerOptions = {},
  ){
    // set default options
    options.loginStatusView ??= LoginStatusView;

    super(parent, options);

    // Initialise Identity (depending on local options and circumstances, this
    // can mean logging into an existing one, creating a new one,
    // or doing nothing at all).
    this.ready = this.initialiseIdentity();

    // Create and render the login status view
    this.loginStatusView = this.constructViewIfRequired(options.loginStatusView, {});
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
    if (this._identity) this.loginStatusView?.renderLoggedIn?.(this._identity);
    else this.loginStatusView?.renderLoggedOut?.();
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
    this.contentAreaView?.clearAlerts?.();

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
    if (globalThis.PasswordCredential) {
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
    this.contentAreaView?.clearAlerts?.();

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
      this.contentAreaView?.makeAlert?.(
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
  // Framework event handling
  //***

  async identityChanged(): Promise<boolean> {
    // Identity controller must ignore its own identityChanged events
    // as it is the very instance causing them.
    return true;
  }


  //***
  // PRIVATE Business logic invocation methods
  //***

  private async initialiseIdentity(): Promise<void> {
    await sodium.ready;

    // Set default options
    this.options.autoCreateIdentity ??= WebuiSettings.AUTO_CREATE_IDENTITY;
    this.options.autoCreateIdentityName ??= WebuiSettings.AUTO_CREATE_IDENTITY_NAME;

    // Create an IdentityStore unless we already have on
    this.options.identityStore ??= new IdentityStore(this.node.veritumRetriever);

    // Default to using persistent local Identities (unless disabled in settings)
    if (this.options.identityPersistence === undefined && WebuiSettings.USE_IDENTITY_PERSISTENCE) {
      this.options.identityPersistence = await IdentityPersistence.Construct(this.options);
    }

    let identity: Identity;

    // If feature enabled, load any existing locally persistent Identity
    if (identity === undefined && this.options.identityPersistence) {
      identity = await this.loadLocal();
    }
    // If feature enabled and there is no logged in Identity yet,
    // create a new one (based on a new random master key).
    if (identity === undefined && this.options.autoCreateIdentity) {
      identity = Identity.New(this.node.veritumRetriever, this.options);
      identity.name = this.options.autoCreateIdentityName;
    }

    this.finaliseLogin(identity);
  }


  /**
   * Log in to the (first) locally stored Identity.
   */
  private async loadLocal(): Promise<Identity> {
    // This does obviously not work if we are not using Identity persistence
    if (this.options.identityPersistence === false) return undefined;

    // Fetch the locally stored Identity/Identities;
    // if there are multiple, select the first one (our UI does not yet
    // support managing multiple stored Identities).
    const idlist: Identity[] = await Identity.Retrieve(
      this.node.veritumRetriever, this.options);
    let identity: Identity = undefined;
    if (idlist?.length) identity = idlist[0];
    return identity;
  }

  private async finaliseLogin(identity?: Identity): Promise<void> {
    // Set this Identity as the currently logged in one
    this._identity = identity;

    // Update the view
    this.showLoginStatus();

    if (identity !== undefined) {
      // If we're using Identity persistence:
      // - make sure the Identity object knows about it
      identity.options.identityPersistence = this.options.identityPersistence;
      // - store the logged in Identity persistently;
      //   don't use identity.store() to avoid recompiling it.
      identity.persistance?.store?.(identity);
    }

    // Inform our controllers that the identity has changed
    // (which will reload them unless they handle the event internally)
    await this.parent.nav.identityChanged();

    // Close the login form
    this.close();
  }
}
