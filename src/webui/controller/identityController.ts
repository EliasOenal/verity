import { Identity, IdentityPersistance } from "../../cci/identity";
import { CubeStore } from "../../core/cube/cubeStore";
import { LoginFormView } from "../view/loginFormView";
import { LoginStatusView } from "../view/loginStatusView";
import { VerityView } from "../view/verityView";
import { VerityController } from "./verityController";

export class IdentityController extends VerityController {
  loginStatusView: LoginStatusView = new LoginStatusView();
  persistence: IdentityPersistance = new IdentityPersistance("identity");

  private mainAreaView: VerityView = undefined;

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
    this.mainAreaView = new LoginFormView();
    this.mainAreaView.show();
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
      identity.store();
    }
    this._identity = identity;
    this.showLoginStatus();
    this.mainAreaView?.shutdown();
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

  }
}