import { VerityUI } from "../verityUI";
import { ZwAnnotationEngine, SubscriptionRequirement } from "../../app/zw/model/zwAnnotationEngine";
import { ControllerContext, ControllerError, VerityController } from "../verityController";
import { PostController } from "../../app/zw/webui/post/postController";
import { CubeExplorerController } from "../cubeExplorer/cubeExplorerController";

import { logger } from "../../core/logger";
import { NavigationView } from "./navigationView";
import { Identity } from "../../cci/identity/identity";

export interface NavItem {
  controller: string,
  navAction: string,
  text?: string,
  exclusive?: boolean,
}

interface ControllerStackLayer {
  controller: VerityController;
  navId: string;
  navAction: string;
};

/**
 * The NavigationController is a special one, as it not only controls
 * the navigation bar but also owns and controls all other Controllers.
 * Maybe it's even a stretch calling the NavigationController a controller,
 * perhaps NavigationGrandmaster would have been more appropriate.
 **/
export class NavigationController extends VerityController {
  constructor(readonly parent: VerityUI){
    super(parent);
  }

  //***
  // View selection methods
  //***
  // TODO: Provide some visual feedback on navigation as controllers could
  // potentially take significant time to build their view.
  // Let's maybe run Vera's animation and slowly grey out the previous view.
  async showNew(navItem: NavItem, show: boolean = true): Promise<void> {
    if (navItem.exclusive) this.closeAllControllers(false);
    const controller: VerityController = this.instantiateController(navItem.controller);
    // TODO: before awaiting selectView() we should display some feedback
    // to the user, e.g. a loading animation or something
    await controller.selectView(navItem.navAction);
    this.newControlLayer({
      controller: controller,
      navAction: navItem.navAction,
      navId: `verityNav-${navItem.controller}.${navItem.navAction}`,
    });
    if (show) this.currentController.contentAreaView.show();
  }

  async show(controllerId: number, navName: string, show: boolean = true): Promise<void> {
    const controller: VerityController =
      this.registeredControllers.get(controllerId);
    if (controller === undefined) {
      throw new NoSuchController(controllerId.toString());
    }
    await controller.selectView(navName);
    this.newControlLayer({
      controller: controller,
      navAction: navName,
      navId: `verityNav-${controllerId}.${navName}`,
    });
    if (show) this.currentController.contentAreaView.show();
  }

  //***
  // Navbar (and other navigation element) management
  //***
  navigationView: NavigationView = new NavigationView();

  makeNavItem(navItem: NavItem): void {
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
   * Controller class registry
   * (TODO document more thoroughly)
   **/
  private controllerClasses: Map<string, typeof VerityController> = new Map();
  registerControllerClass(name: string, ctrlClass: typeof VerityController) {
    this.controllerClasses.set(name, ctrlClass);
  }

  /**
   * Controller instance registry
   */
  private registeredControllers: Map<number, VerityController> = new Map();
  controllerRegistryHighestId: number = 0;
  registerController(controller: VerityController): number {
    this.controllerRegistryHighestId++;
    this.registeredControllers.set(this.controllerRegistryHighestId, controller);
    return this.controllerRegistryHighestId;
  }
  unregisterController(id: number) {
    this.registeredControllers.delete(id);
  }

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

  private instantiateController(ctrlClassId: string): VerityController {
    // instantiate controller
    const controllerClass: typeof VerityController =
      this.controllerClasses.get(ctrlClassId);
    if (controllerClass === undefined) throw new NoSuchController(ctrlClassId);
    const controller: VerityController = new controllerClass(this.parent);
    return controller;
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

  closeController(controllerStackIndex: VerityController | number, updateView: boolean = true): void {
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
    const layer = this.controllerStack[controllerStackIndex];
    layer.controller.close(false, false);  // close controller, but don't unshow yet
    this.controllerStack.splice(controllerStackIndex, 1);  // remove it from stack
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
    return layer.controller.selectView(layer.navAction);
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
