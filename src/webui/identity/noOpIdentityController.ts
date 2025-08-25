import { Identity } from "../../cci/identity/identity";
import { IdentityStore } from "../../cci/identity/identityStore";
import { IdentityPersistence } from "../../cci/identity/identityPersistence";
import { ControllerContext, VerityController } from "../verityController";
import { VerityView } from "../verityView";

/**
 * A no-operation IdentityController for applications that don't need identity features.
 * This satisfies the ControllerContext interface requirement while doing nothing.
 */
export class NoOpIdentityController extends VerityController {
  readonly loginStatusView: NoOpLoginStatusView;
  readonly ready: Promise<void> = Promise.resolve();

  private _identity: Identity = undefined;
  get identity(): Identity { return this._identity; }
  set identity(identity: Identity) { this._identity = identity; }

  get identityStore(): IdentityStore { return undefined; }
  get persistence(): IdentityPersistence { return undefined; }

  constructor(parent: ControllerContext) {
    super(parent);
    this.loginStatusView = new NoOpLoginStatusView(this);
  }

  async showLoginStatus(): Promise<void> {
    // No-op
  }

  async initialiseIdentity(): Promise<void> {
    // No-op
  }

  async shutdown(unshow: boolean = true, callback: boolean = true): Promise<void> {
    // No-op
    await super.shutdown(unshow, callback);
  }
}

/**
 * A no-operation LoginStatusView that provides the required interface but does nothing
 */
class NoOpLoginStatusView extends VerityView {
  constructor(controller: VerityController) {
    // Create a minimal dummy element to satisfy the VerityView constructor
    const template = document.createElement('template');
    template.innerHTML = '<div style="display: none;"></div>';
    const viewArea = document.createElement('div');
    viewArea.style.display = 'none';
    
    super(controller, template, viewArea);
  }

  renderLoggedOut(show: boolean = false): void {
    // No-op
  }

  renderLoggedIn(identity: Identity, show: boolean = false): void {
    // No-op
  }

  show(): void {
    // No-op - don't actually show anything
  }

  hide(): void {
    // No-op
  }
}