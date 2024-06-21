import { NavigationView } from "./navigationView";
import { ControllerContext, ControllerError, NavControllerInterface, VerityController } from "../verityController";
import { VerityUI } from "../verityUI";

import { logger } from "../../core/logger";

export interface NavItem {
  /**
   * An existing VerityController or a VerityController subclass which will
   * handle the navigation request and display the appropriate view.
   **/
  controller: VerityController | typeof VerityController,

  /** The controller method used to build this view */
  navAction: ()=>Promise<void>,

  /** The link text to be displayed to the user */
  text?: string,

  /**
   * Whether calling this nav item should close all previous controllers.
   * If false, the new controller will be added to the stack of controllers
   * and a back arrow will be displayed to allow the user to return to the
   * previous controller.
   **/
  exclusive?: boolean,

  /**
   * If true, the controller managing this view will only be closed rather than
   * shut down when the nav item is closed.
   * This is only useful for controllers doing other work in the background as
   * opposed to just managing a view, and should of course only be used with
   * pre-instantiated controllers (otherwise memory leaks will ensue, or worse!)
   **/
  keepAliveOnClose?: boolean,

  /**
   * This attribute will be set automatically by NavController whenever
   * makeNavItem() is called. It's the navigation link's ID attribute in the DOM.
   */
  navId?: string;
}

interface ControllerStackLayer extends NavItem {
  /**
   * The VerityController managing this view.
   * In contrast to NavItem, this is now definitely an instance rather than a class.
   **/
  controller: VerityController;

  /** The controller method used to build the selected view */
  navAction: ()=>Promise<void>;
};

/**
 * The NavigationController is a special one, as it not only controls
 * the navigation bar but also owns and controls all other Controllers.
 * Maybe it's even a stretch calling the NavigationController a controller,
 * perhaps NavigationGrandmaster would have been more appropriate.
 **/
export class NavigationController extends VerityController implements NavControllerInterface {
  lastNavId: number = 0;

  constructor(readonly parent: VerityUI){
    super(parent);
  }

  //***
  // View selection methods
  //***
  // TODO: Provide some visual feedback on navigation as controllers could
  // potentially take significant time to build their view.
  // Let's maybe run Vera's animation and slowly grey out the previous view.
  async show(navItem: NavItem, show: boolean = true): Promise<void> {
    if (navItem.exclusive) this.closeAllControllers(false);
    let controller: VerityController;
    if (navItem.controller instanceof VerityController) {
      controller = navItem.controller;
    } else {
      // instantiate controller
      controller = new navItem.controller(this.parent);
    }

    // TODO: before awaiting the view we should display some feedback
    // to the user, e.g. a loading animation or something
    const viewBuilder: () => Promise<void> =
      navItem.navAction.bind(controller);
    await viewBuilder();
    this.newControlLayer({
      controller: controller,
      navAction: navItem.navAction,
      navId: navItem.navId,
      keepAliveOnClose: navItem.keepAliveOnClose,
    });
    if (show) this.currentController.contentAreaView.show();
  }

  //***
  // Navbar (and other navigation element) management
  //***
  navigationView: NavigationView = new NavigationView(this);

  makeNavItem(navItem: NavItem): void {
    navItem.navId = `verityNav-${++this.lastNavId}`;
    this.navigationView.makeNavItem(navItem);
  }

  private displayOrHideBackButton() {
    if (this.controllerStack.length > 1) this.navigationView.displayBackButton();
    else this.navigationView.hideBackButton();
  }

  //***
  // Controller management
  //***

  /**
   * The stack of active controllers for verityContentArea.
   * The top one always has control and can conveniently be retrieved by
   * accessing currentController instead.
   * For each controller in controllerStack, we also remember the associated
   * function to invoke on the controller and the active nav bar item.
   * If there is no associated active nav bar item, we explicitly
   * store undefined, which means all nav bar items marked inactive.
   */
  controllerStack: ControllerStackLayer[] = [];

  get currentControlLayer(): ControllerStackLayer {
    if (this.controllerStack.length === 0) return undefined;
    else return this.controllerStack[this.controllerStack.length-1];
  }

  /**
   * The controller currently owning verityContentArea.
   * This is always the top controller on the controllerStack; and we will
   * conveniently display a back button to close it and return control to the
   * one below :)
  **/
  get currentController(): VerityController {
    return this.currentControlLayer?.controller;
  }

  newControlLayer(
      layer: ControllerStackLayer,
  ): void {
    this.controllerStack.push(layer);
    this.displayOrHideBackButton();  // Only show back button if there's something to go back to.
    this.navigationView.navbarMarkActive(layer.navId);  // Update active nav bar item.
  }

  closeCurrentController(updateView: boolean = true) {
    if (this.controllerStack.length > 0) {
      this.closeController(this.controllerStack.length - 1, updateView);
    }
  }

  closeController(controllerStackIndex: VerityController | number, updateView: boolean = true, unregister: boolean = true): void {
    // Make sure we have the controller stack index, as we'll need it to remove
    // it from the controllerStack array later
    if (typeof controllerStackIndex !== 'number') {
      for (let i=0; i<this.controllerStack.length; i++) {
        if (this.controllerStack[i].controller === controllerStackIndex) {
          controllerStackIndex = i;
          break;
        }
      }
    }
    if (typeof controllerStackIndex !== 'number') {
      logger.error("NavigationController: Tried to close a Controller which is not on my controller stack; ignoring.");
      return;
    }
    // Make sure we have the actual controller stack layer as well
    const layer = this.controllerStack[controllerStackIndex];

    // Remove controller from my controller stack
    this.controllerStack.splice(controllerStackIndex, 1);
    // Close controller, but don't unshow yet.
    // Shut it down completely by default, except if it requested to keep runnning.
    if (layer.keepAliveOnClose) layer.controller.close(false, false);
    else layer.controller.shutdown(false, false);

    if (updateView) {  // make the UI reflect the controller change
      this.displayOrHideBackButton();  // Only show back button if there's something to go back to.
      if (this.currentController !== undefined) {
        // if possible, show the latest Controller again
        this.currentController.contentAreaView.show();
      } else {
        // if there is none, just show an empty content area
        layer.controller.contentAreaView.unshow();
      }
      // Update active nav bar item
      this.navigationView.navbarMarkActive(this.currentControlLayer?.navId);
    }
  }

  closeAllControllers(updateView: boolean = true) {
    while(this.currentController !== undefined) {
      this.closeCurrentController(updateView);
    }
  }

  restartController(layer: ControllerStackLayer, alreadyRestarted: VerityController[]): Promise<void> {
    if (!alreadyRestarted.includes(layer.controller)) {
      // only re-instantiate controller once
      const Constructor = layer.controller.constructor as { new (parent: ControllerContext): VerityController }
      layer.controller = new Constructor(this.parent);
    }
    // but always re-trigger the navigation action
    const viewBuilder: () => Promise<void> =
      layer.navAction.bind(layer.controller);
    return viewBuilder();
  }


  /**
   * Using this method, Controllers (in practice: IdentityController)
   * can let us know that there has been a breaking change in user Identity,
   * e.g. a log in or log out. We will then let our Controllers know,
   * and restart them if they do not implement a handler for this event.
   */
  identityChanged(): Promise<boolean> {
    let currentControllerPromise: Promise<any>;
    const alreadyRestarted: VerityController[] = [];
    for (let i=0; i<this.controllerStack.length; i++) {
      const layer: ControllerStackLayer = this.controllerStack[i];
      const controller: VerityController = this.controllerStack[i].controller;
      const eventHandledPromise: Promise<boolean> = controller.identityChanged();
      const donePromise: Promise<any> = new Promise<void>(resolve => {
        eventHandledPromise.then((eventHandled: boolean) => {
          if (!eventHandled) {
            const controllerRestartedPromise: Promise<void> =
              this.restartController(this.controllerStack[i], alreadyRestarted);
            controllerRestartedPromise.then(resolve);
          } else resolve();
        });
      });
      if (layer === this.currentControlLayer) {
        currentControllerPromise = donePromise;
      }
    }
    // reshow the current controller once it has been updated
    currentControllerPromise.then(
      () => this.currentController.contentAreaView?.show());
    // let's just wait for the topmost controller to be done
    return new Promise<boolean>(resolve =>
      currentControllerPromise.then(() => resolve(true)));
  }
}

export class NoSuchController extends ControllerError { name = "NoSuchController "}
