import { VerityView } from "./verityView";
import { UiError } from "./webUiDefinitions";

import type { Identity } from "../cci/identity/identity";
import type { VerityNode } from "../core/verityNode";
import type { CubeStore } from "../core/cube/cubeStore";
import type { NavItem } from "./navigation/navigationController";

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
  show(navItem: NavItem, show?: boolean): Promise<void>;
  closeController(controllerStackIndex: VerityController | number, updateView?: boolean): void;
  identityChanged(): Promise<boolean>;
}

/** Mock for testing only */
export class DummyNavController implements NavControllerInterface {
  show(navItem: NavItem, show?: boolean): Promise<void> { return new Promise<void>(resolve => {resolve()})}
  closeController(controllerStackIndex: number | VerityController, updateView?: boolean): void {}
  identityChanged(): Promise<boolean> { return new Promise<boolean>(resolve => {resolve(true)})}
}

/** Abstract base class for our controllers */
export class VerityController {
  public contentAreaView: VerityView = undefined;
  get cubeStore(): CubeStore { return this.parent.node.cubeStore }
  get identity(): Identity { return this.parent.identity }

  constructor(
    readonly parent: ControllerContext,
  ){
  }

  /**
   * Permanently get rid of this controller.
   * Controllers must not be reused after shutdown; instead a new instance must
   * be created if needed.
   * @param [unshow=true] Whether to immediately un-show the associated view,
   *   i.e. remove it from the DOM. Otherwise, it will stick around on the DOM
   *   until you remove it yourself.
   **/
  // Subclasses should override this and add additional cleanup code
  // if necessary.
  // TODO BUGBUG: We must actually start using this, we're currently probably
  // leaking stale controller objects whereever we go
  shutdown(unshow: boolean = true, callback: boolean = true): Promise<void> {
    this.contentAreaView?.shutdown?.(unshow);
    if (callback) this.parent.nav.closeController(this);
    // Return a resolved promise
    return new Promise<void>(resolve => resolve());
  }

  /**
   * Closes this controller, but allows it to remain active in the
   * background if this particular type of controller supports it.
   **/
  // This redirects to shutdown by default as we don't want controllers
  // sticking around for no reason. Controllers actually wishing to continue
  // running in the background must override this method.
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
