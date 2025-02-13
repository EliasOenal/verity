import { ControllerStackLayer, NavControllerIf, NavItem } from "./navigationDefinitions";
import { NavigationView } from "./navigationView";
import { ControllerContext, ControllerError, VerityController, VerityControllerOptions } from "../verityController";

import { logger } from "../../core/logger";

/**
 * The NavigationController is a special one, as it not only controls
 * the navigation bar but also owns and controls all other Controllers.
 * Maybe it's even a stretch calling the NavigationController a controller,
 * perhaps NavigationGrandmaster would have been more appropriate.
 **/
export class NavigationController extends VerityController implements NavControllerIf {
  /**
   * Navigation links in the DOM will be given an ID attribute with a unique
   * number. This number will be incremented every time a new navigation link
   * is created, so that we can easily identify and manipulate them.
   **/
  lastNavId: number = 0;

  constructor(readonly parent: ControllerContext, options: VerityControllerOptions = {}){
    options.contentAreaView = options.contentAreaView ?? NavigationView;
    super(parent, options);
    parent.nav = this;  // I am the NavController!
  }

  //***
  // View selection methods
  //***

  /**
   * Show a view by either instantiating the controller or taking an existing
   * controller instance and calling the navAction method on it.
   * @param navItem The NavItem dataset describing the view to show.
   * @param show Whether to show the view immediately after building it.
   *             You will usually want to leave this at default (true).
   */
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
    const navAction: () => Promise<void> =
      navItem.navAction.bind(controller);
    await navAction();
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
  declare contentAreaView: NavigationView;
  get navigationView(): NavigationView { return this.contentAreaView }

  /**
   * Create a new navigation link in the navigation bar.
   * @param navItem The NavItem dataset describing the navigation item.
   */
  makeNavItem(navItem: NavItem): void {
    navItem.navId = `verityNav-${++this.lastNavId}`;
    this.navigationView.makeNavItem(navItem);
  }

  /**
   * Display or hide the back button in the navigation bar depending on whether
   * there are controllers below the current one on the stack to go back to.
   */
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

  /**
   * The controller layer currently owning verityContentArea.
   */
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

  /**
   * Add a new controller to the controller stack.
   * You will usually not want to call this directly, but rather use the show()
   * method to show a view and add the controller to the stack.
   * @param layer The controller layer to add to the stack.
   */
  newControlLayer(
      layer: ControllerStackLayer,
  ): void {
    this.controllerStack.push(layer);
    this.displayOrHideBackButton();  // Only show back button if there's something to go back to.
    this.navigationView.navbarMarkActive(layer.navId);  // Update active nav bar item.
  }

  /**
   * Close the current controller and return control to the one below, if any.
   * You will usually not want to call this directly. Rather, this will be called
   * if the user clicks the back button, or if a controller chooses to self-close.
   * @param updateView Whether to update the view after closing the controller.
   */
  closeCurrentController(updateView: boolean = true) {
    if (this.controllerStack.length > 0) {
      this.closeController(this.controllerStack.length - 1, updateView);
    }
  }

  /**
   * Close a controller and remove it from the controller stack.
   * You will usually not want to call this directly.
   * @param controllerStackIndex Either the controller to close or
   *                             its index in the controller stack.
   * @param updateView Whether to update the view after closing the controller.
   * @param unregister
   * @returns
   */
  closeController(
      controllerStackIndex: VerityController | number,
      updateView: boolean = true,
  ): void {
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

  /**
   * Close all controllers and remove them from the controller stack.
   * You will usually not want to call this directly. Rather, this will be
   * called automatically if a NavItem with the exclusive flag set is shown.
   * @param updateView Whether to update the view after closing the controllers.
   */
  closeAllControllers(updateView: boolean = true) {
    while(this.currentController !== undefined) {
      this.closeCurrentController(updateView);
    }
  }

  /**
   * Restart a controller, i.e. re-instantiate it and re-trigger the navigation.
   * You will usually not want to call this directly. Rather, this will be
   * called automatically if a controller signals that the user's identity
   * has changed.
   * @param layer The controller layer to restart.
   * @param alreadyRestarted A list of controllers that have already been
      *                      restarted and will therefore not be restarted again.
   */
  restartController(layer: ControllerStackLayer, alreadyRestarted: VerityController[] = []): Promise<void> {
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
