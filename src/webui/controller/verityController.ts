import { VerityView } from "../view/verityView";

import EventEmitter from "events";
import { UiError } from "../webUiDefinitions";

import type { Identity } from "../../cci/identity/identity";
import type { NavigationController } from "./navigationController";
import type { VerityNode } from "../../core/verityNode";
import type { CubeStore } from "../../core/cube/cubeStore";

export interface ControllerContext {
  node: VerityNode;
  identity: Identity;
  nav: NavigationController;
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
  shutdown(callback: boolean = true): Promise<void> {
    if (this.contentAreaView) this.contentAreaView.shutdown();
    if (callback) this.parent.nav.closeController(this);
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
}

export class ControllerError extends UiError { name = "ControllerError" }
export class NoSuchView extends ControllerError { name = "NoSuchView" }
