import { VerityUI } from "../verityUI";
import { ZwAnnotationEngine, SubscriptionRequirement } from "../../app/zw/zwAnnotationEngine";
import { ControllerError, VerityController } from "./verityController";
import { PostController } from "./postController";
import { CubeExplorerController } from "./cubeExplorerController";

import { logger } from "../../core/logger";

interface ControllerStackLayer {
  controller: VerityController;
  navId: string;
  navName: string;
};

/**
 * The NavigationController is a special one, as it not only controls
 * the navigation bar but also owns and controls all other Controllers.
 * Maybe it's even a stretch calling the NavigationController a controller,
 * perhaps NavigationGrandmaster would have been more appropriate.
 **/
export class NavigationController extends VerityController {
  /**
   * Static controller registry
   * Controller *classes* auto-register here on inception.
   * (TODO document more thoroughly)
   **/
  private static ControllerClasses: Map<string, typeof VerityController> = new Map();
  static RegisterController(name: string, ctrlClass: typeof VerityController) {
    this.ControllerClasses.set(name, ctrlClass);
  }

  /**
   * Dynamic controller registry
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

  constructor(readonly parent: VerityUI){
    super(parent);
  }

  get currentControlLayer(): ControllerStackLayer {
    if (this.controllerStack.length === 0) return undefined;
    else return this.controllerStack[this.controllerStack.length-1];
  }

  /**
   * The controller currently owning verityContentArea.
   * This is always to top controller on the controllerStack; and we will
   * conveniently display a back button to close it and return control to the
   * one below :)
  **/
  get currentController(): VerityController {
    return this.currentControlLayer?.controller;
  }

  async showNew(controllerName: string, navName: string): Promise<void> {
    // instantiate controller
    const controllerClass: typeof VerityController =
    NavigationController.ControllerClasses.get(controllerName);
    if (controllerClass === undefined) throw new NoSuchController(controllerName);
    const controller: VerityController = new controllerClass(this.parent);
    // TODO: before awaiting selectView() we should display some feedback
    // to the user, e.g. a loading animation or something
    await controller.selectView(navName);
    this.newControlLayer({
      controller: controller,
      navName: navName,
      navId: `verityNav-${controllerName}.${navName}`,
    });
    this.currentController.contentAreaView.show();
  }

  showNewExclusive(controller: string, navName: string): Promise<void> {
    this.closeAllControllers(false);
    return this.showNew(controller, navName);
  }

  async show(controllerId: number, navName: string): Promise<void> {
    const controller: VerityController =
      this.registeredControllers.get(controllerId);
    if (controller === undefined) {
      throw new NoSuchController(controllerId.toString());
    }
    await controller.selectView(navName);
    this.newControlLayer({
      controller: controller,
      navName: navName,
      navId: `verityNav-${controllerId}.${navName}`,
    });
    this.currentController.contentAreaView.show();
  }

  newControlLayer(
      layer: ControllerStackLayer,
  ): void {
    this.controllerStack.push(layer);
    this.displayOrHideBackButton();  // Only show back button if there's something to go back to.
    this.navbarMarkActive(layer.navId);  // Update active nav bar item.
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
      this.navbarMarkActive(layer.navId);  // Update active nav bar item.
    }
  }

  closeAllControllers(updateView: boolean = true) {
    while(this.currentController !== undefined) {
      this.closeCurrentController(updateView);
    }
  }

  private displayOrHideBackButton() {
    // HACKHACK: UI code should be encapsulated somewhere, e.g. in a View...
    const backArea = document.getElementById("verityBackArea");
    if (this.controllerStack.length > 1) backArea.setAttribute("style", "display: block");
    else backArea.setAttribute("style", "display: none");
  }

  private navbarMarkActive(id: string) {
    for (const nav of document.getElementsByClassName("nav-item")) {
      if (nav.id == id) nav.classList.add("active");
      else nav.classList.remove("active");
    }
  }
}

export class NoSuchController extends ControllerError { name = "NoSuchController "}
