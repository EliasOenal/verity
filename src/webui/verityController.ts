import { VerityView } from "./verityView";
import { UiError } from "./webUiDefinitions";

import type { Identity } from "../cci/identity/identity";
import { DummyVerityNode, type VerityNode, type VerityNodeIf } from "../core/verityNode";
import type { CubeStore } from "../core/cube/cubeStore";
import { DummyNavController, type NavControllerIf, type NavItem } from "./navigation/navigationDefinitions";
import { CubeRetriever } from "../core/networking/cubeRetrieval/cubeRetriever";
import { cciNodeIf, DummyCciNode } from "../cci/cciNode";
import { Cockpit } from "../cci/cockpit";

/**
 * The interface a controller's parent object needs to provide;
 * usually implemented by VerityUi.
 */
export interface ControllerContext {
  /**
   * Provides access to the Verity core node, including stuff like Cube storage
   * and retrieval as well as networking
   **/
  node: cciNodeIf;

  cockpit: Cockpit

  /** Optionally, the Identity of the currently logged in user */
  identity?: Identity;

  /**
   * The navigation controller,
   * which is the central instance controlling the user interface.
   */
  nav: NavControllerIf;
}

/** Dummy for testing only */
export class DummyControllerContext implements ControllerContext {
  constructor(
    public readonly node: cciNodeIf = new DummyCciNode(),
    public readonly nav: NavControllerIf = new DummyNavController(),
    public readonly cockpit: Cockpit = new Cockpit(node),
  ) {}
}

export interface VerityControllerOptions {
  contentAreaView?: VerityView | typeof VerityView;
  htmlTemplateOverride?: HTMLTemplateElement;
}

/** Abstract base class for our controllers */
export class VerityController {
  public contentAreaView: VerityView = undefined;
  get cubeStore(): CubeStore { return this.parent?.node?.cubeStore }
  get cubeRetriever(): CubeRetriever { return this.parent?.node?.cubeRetriever }
  get identity(): Identity { return this.parent?.identity }
  get cockpit(): Cockpit { return this.parent?.cockpit }

  constructor(
    readonly parent: ControllerContext,
    public options: VerityControllerOptions = {}
  ){
    // If specified, set or instantiate the contentAreaView.
    if (options.contentAreaView) {
      if (options.contentAreaView instanceof VerityView) {
        this.contentAreaView = options.contentAreaView;
      } else this.contentAreaView = new options.contentAreaView(
          this, options.htmlTemplateOverride);
    }
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
