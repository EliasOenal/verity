import { VerityView } from "./verityView";
import { UiError } from "./webUiDefinitions";

import type { Identity } from "../cci/identity/identity";
import type { VerityNode } from "../core/verityNode";
import type { CubeStore } from "../core/cube/cubeStore";

/**
 * The interface a controller's parent object needs to provide;
 * usually implemented by VerityUi.
 */
export interface ControllerContext {
  node: VerityNode;
  identity: Identity;
  nav: NavControllerInterface;
}

export interface NavControllerInterface {
  registerController(controller: VerityController): number;
  closeController(controllerStackIndex: VerityController | number, updateView?: boolean): void;
  unregisterController(controller: number | VerityController): void;
  identityChanged(): Promise<boolean>;
}

/** Mock for testing only */
export class DummyNavController implements NavControllerInterface {
  registerController(controller: VerityController): number { return 0; }
  closeController(controllerStackIndex: number | VerityController, updateView?: boolean): void {}
  unregisterController(controller: number | VerityController): void {}
  identityChanged(): Promise<boolean> { return new Promise<boolean>(resolve => {resolve(true)})}
}

/** Abstract base class for our controllers */
export class VerityController {
  public contentAreaView: VerityView = undefined;
  readonly viewSelectMethods: Map<string, () => Promise<void>> = new Map();
  readonly navId: number = undefined;

  get cubeStore(): CubeStore { return this.parent.node.cubeStore }
  get identity(): Identity { return this.parent.identity }

  constructor(
    readonly parent: ControllerContext,
  ){
    this.navId = this.parent?.nav?.registerController(this);
  }

  selectView(name: string): Promise<void> {
    const func: ()=>Promise<void> = this.viewSelectMethods.get(name);
    if (func) return func.call(this);
    else throw new NoSuchView(name);
  }

  /**
   * Permanently get rid of this controller.
   * Controllers must not be reused after shutdown; instead a new instance must
   * be created if needed.
   **/
  // Subclasses should override this and add additional cleanup code
  // if necessary.
  // TODO BUGBUG: We must actually start using this, we're currently probably
  // leaking stale controller objects whereever we go
  shutdown(callback: boolean = true): Promise<void> {
    if (this.contentAreaView) this.contentAreaView.shutdown();
    if (callback) {
      this.parent.nav.closeController(this);
      this.parent.nav.unregisterController(this);
    }
    // Return a resolved promise
    return new Promise<void>(resolve => resolve());
  }

  /**
   * Closes this controller, but allows it to remain active in the
   * background if this particular type of controller supports it.
   **/
  // Subclasses should override this and add additional cleanup code
  // if necessary.
  close(unshow: boolean = true, callback: boolean = true): Promise<void> {
    if (unshow && this.contentAreaView) this.contentAreaView.unshow();
    if (callback) this.parent.nav.closeController(this);
    // Return a resolved promise
    return new Promise<void>(resolve => resolve());
  }

  /**
   * Using this callback other modules can let us notify about a breaking
   * change in user Identity, e.g. a log in or log out.
   * Subclasses should override this method to handle this even in whichever
   * way appropriate and return true afterwards.
   * In pratice, this will get called by VerityUI and VerityUI will restart
   * this controller if it doesn't return true to indicate the change was
   * handled internally.
   * The new Identity will be available as this.identity.
   * @returns Whether the event was handled or not.
   */
  async identityChanged(): Promise<boolean> {
    return false;
  }
}

export class ControllerError extends UiError { name = "ControllerError" }
export class NoSuchView extends ControllerError { name = "NoSuchView" }
