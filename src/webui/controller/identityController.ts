import { CubeStore } from "../../core/cube/cubeStore";

import { Identity, IdentityOptions } from "../../cci/identity/identity";
import { IdentityPersistence, IdentityPersistenceOptions } from "../../cci/identity/identityPersistence";

import { EditIdentityView } from "../view/editIdentityView";
import { LoginFormView } from "../view/loginFormView";
import { LoginStatusView } from "../view/loginStatusView";
import { VerityView } from "../view/verityView";
import { ControllerContext, VerityController } from "./verityController";

import { Avatar, AvatarScheme } from "../../cci/identity/avatar";
import { NavigationController } from "./navigationController";

export class IdentityController extends VerityController {
  loginStatusView: LoginStatusView;

  private _identity: Identity = undefined;
  get identity(): Identity { return this._identity}
  set identity(identity: Identity) {
    this._identity = identity;
    this.showLoginStatus();
  }

  get persistence(): IdentityPersistence { return this.options.persistence }

  constructor(
    parent: ControllerContext,
    readonly options: IdentityOptions&IdentityPersistenceOptions = {},
  ){
    super(parent);
    if (options.persistence === undefined) {
      options.persistence = new IdentityPersistence(options);
    }
    this.loginStatusView = new LoginStatusView(this.navId);
    this.showLoginStatus();

    // set nav methods
    this.viewSelectMethods.set("login", this.selectLoginForm);
    this.viewSelectMethods.set("edit", this.selectEditForm);
  }

  //***
  // View selection methods
  //***
  selectLoginForm(): Promise<void> {
    this.contentAreaView = new LoginFormView();
    return new Promise<void>(resolve => resolve());  // nothing to do, return resolved promise
  }

  selectEditForm(): Promise<void> {
    this.contentAreaView = new EditIdentityView(this.identity);
    (this.contentAreaView as EditIdentityView).displayAvatar(
      this._identity.avatar?.seedString, this.identity.avatar.render());
    return new Promise<void>(resolve => resolve());  // nothing to do, return resolved promise
  }


  //***
  // View assembly methods
  //***

  showLoginStatus() {
    if (this._identity) this.loginStatusView.showLoggedIn(this._identity);
    else this.loginStatusView.showNotLoggedIn();
  }


  //***
  // Navigation methods
  //***

  /**
   * Called from: login form view
   * Submit method.
   */
  async performLogin(form: HTMLFormElement) {
    const username: string =
      (form.querySelector(".verityUsernameInput") as HTMLInputElement).value;
    const password: string =
      (form.querySelector(".verityPasswordInput") as HTMLInputElement).value;
    // TODO: enforce some minimum length for both
    let identity: Identity = await Identity.Load(
      this.cubeStore, username, password, this.options);
    if (identity instanceof Identity) {
      identity.persistance.store(identity);  // don't use identity.store() to avoid MUC rebuild
    } else {
      identity = await Identity.Create(
        this.cubeStore, username, password, this.options);
      identity.name = username;  // TODO separate username and display name
      identity.store("ID/ZW");
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
      window?.navigator?.credentials?.store(passwordCredential);
    }
    this._identity = identity;
    this.showLoginStatus();
    this.close();
  }

  /**
   * Called from: login status view
   * Logs the current user out.
   */
  logOut() {
    // TODO: handle the various Identites we may have in our local Identity DB
    // sensibly. Either expose them as various locally saved accounts, or just
    // delete them on logout, or whatever. But do something!
    this._identity = undefined;
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
    this._identity.store("ID/ZW");
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
    const idlist: Identity[] = await Identity.retrieve(this.cubeStore, this.options);
    let identity: Identity = undefined;
    if (idlist?.length) identity = idlist[0];
    this.showLoginStatus();
    if (identity) {
      this.identity = identity;
      return true;
    } else return false;
  }
}

NavigationController.RegisterController("identity", IdentityController);
