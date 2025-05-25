import { VerityView } from "./verityView";
import { UiError } from "./webUiDefinitions";

import type { Identity } from "../cci/identity/identity";
import type { CubeRetrievalInterface, CubeStore } from "../core/cube/cubeStore";
import { DummyNavController, type NavControllerIf, type NavItem } from "./navigation/navigationDefinitions";
import { CubeRetriever } from "../core/networking/cubeRetrieval/cubeRetriever";
import { dummyVerityNode, VerityNodeIf } from "../cci/verityNode";
import { Cockpit } from "../cci/cockpit";
import { VeritumRetrievalInterface, VeritumRetriever } from "../cci/veritum/veritumRetriever";
import { CubeRequestOptions } from "../core/networking/cubeRetrieval/requestScheduler";

/**
 * The interface a controller's parent object needs to provide;
 * usually implemented by VerityUi.
 */
export interface ControllerContext {
  /**
   * The cockpit provide a high level API for retrieving and publishin Verita.
   * It also provides access to the Verity node object, including stuff like
   * Cube storage and retrieval as well as networking.
   **/
  cockpit: Cockpit;

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
    node: VerityNodeIf = dummyVerityNode(),
    public readonly nav: NavControllerIf = new DummyNavController(),
    public readonly cockpit: Cockpit = new Cockpit(node),
  ) {}
}

export interface VerityControllerOptions {
  contentAreaView?: VerityView | typeof VerityView;
  htmlTemplateOverride?: HTMLTemplateElement;
}

/** Abstract base class for our controllers */
export class VerityController implements ControllerContext {
  public contentAreaView: VerityView = undefined;

  get cockpit(): Cockpit { return this.parent.cockpit }
  get identity(): Identity { return this.parent.identity }
  get node(): VerityNodeIf { return this.parent.cockpit.node }
  get nav(): NavControllerIf { return this.parent.nav }

  /** @deprecated - Applications should prefer the cockpit API, or use this.node.cubeStore */
  get cubeStore(): CubeStore { return this.parent.cockpit.node.cubeStore }
  /** @deprecated - Applications should prefer the cockpit API, or use this.node.veritumRetriever */
  get veritumRetriever(): VeritumRetrievalInterface<CubeRequestOptions> { return this.parent.cockpit.node.veritumRetriever }
  /** @deprecated - Applications should prefer the cockpit API, or use this.node.cubeRetriever */
  get cubeRetriever(): CubeRetriever | CubeRetrievalInterface<CubeRequestOptions> { return this.parent.cockpit.node.cubeRetriever }

  constructor(
    readonly parent: ControllerContext,
    public options: VerityControllerOptions = {}
  ){
    // If specified, set or instantiate the contentAreaView.
    if (options.contentAreaView) {
      this.contentAreaView = this.constructViewIfRequired(
        options.contentAreaView, this.options);
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


  protected constructViewIfRequired<T extends VerityView>(
    view: VerityView | typeof VerityView | false,
    options: VerityControllerOptions = this.options,
  ): T {
    // If there's already a view object, just return it.
    if (view instanceof VerityView) return view as T;
    // If the view is undefined, return undefined.
    else if (view === undefined || view === null || view === false) return undefined;
    // If the view is a constructor, instantiate it.
    else return new view(this, options.htmlTemplateOverride) as T;
  }

}

export class ControllerError extends UiError { name = "ControllerError" }
export class NoSuchView extends ControllerError { name = "NoSuchView" }
