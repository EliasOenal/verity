import { CubeStore } from "../../core/cube/cubeStore";

import { Identity } from "../../cci/identity/identity";
import { IdentityPersistance } from "../../cci/identity/identityPersistance";

import { EditIdentityView } from "../view/editIdentityView";
import { LoginFormView } from "../view/loginFormView";
import { LoginStatusView } from "../view/loginStatusView";
import { VerityView } from "../view/verityView";
import { VerityController } from "./verityController";

import { Avatar, AvatarScheme } from "../../cci/identity/avatar";

export class IdentityController extends VerityController {
  loginStatusView: LoginStatusView = new LoginStatusView();
  persistence: IdentityPersistance = new IdentityPersistance("identity");

  private _identity: Identity;
  get identity(): Identity { return this._identity}
  set identity(identity: Identity) {
    this._identity = identity;
    this.showLoginStatus();
  }

  constructor(
    readonly cubeStore: CubeStore,
    identity: Identity = undefined,
  ){
    super();
    this._identity = identity;
    this.showLoginStatus();
  }

  showLoginStatus() {
    if (this._identity) this.loginStatusView.showLoggedIn(this._identity);
    else this.loginStatusView.showNotLoggedIn();
  }

  showLoginForm() {
    this.contentAreaView = new LoginFormView();
    this.contentAreaView.show();
  }

  performLogin(form: HTMLFormElement) {
    const username: string =
      (form.querySelector(".verityUsernameInput") as HTMLInputElement).value;
    const password: string =
      (form.querySelector(".verityPasswordInput") as HTMLInputElement).value;
    // TODO: enforce some minimum length for both
    let identity: Identity = Identity.Load(
      this.cubeStore, username, password, {persistance: this.persistence});
    if (identity instanceof Identity) {
      identity.persistance.store(identity);  // don't use identity.store() to avoid MUC rebuild
    } else {
      identity = Identity.Create(
        this.cubeStore, username, password, {persistance: this.persistence});
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

  showEditIdentity() {
    this.contentAreaView = new EditIdentityView(this.identity);
    (this.contentAreaView as EditIdentityView).displayAvatar(
      this._identity.avatar?.seedString, this.identity.avatar.render());
    this.contentAreaView.show();
  }

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

  randomMultiavatar() {
    // This method only makes sense within the edit identity form
    if (!(this.contentAreaView instanceof EditIdentityView)) return;
    const randomAvatar = new Avatar(true);
    this.contentAreaView.displayAvatar(randomAvatar.seedString, randomAvatar.render());
  }
}
