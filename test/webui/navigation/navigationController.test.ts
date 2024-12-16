import { NavigationController } from "../../../src/webui/navigation/navigationController";
import { NavItem, ControllerStackLayer } from "../../../src/webui/navigation/navigationDefinitions";
import { DummyNavigationView } from "../../../src/webui/navigation/navigationView";
import { DummyControllerContext, VerityController, VerityControllerOptions } from "../../../src/webui/verityController";
import { VerityView } from "../../../src/webui/verityView";

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

class DummyVerityController extends VerityController {
  constructor(parent: DummyControllerContext, options?: VerityControllerOptions) {
    super(parent);
    this.contentAreaView = new VerityView(this, undefined, null);
  }
  navActionCalled: boolean = false;
  public async navAction(): Promise<void> {
    this.navActionCalled = true;
    return Promise.resolve()
  }
}

describe('NavigationController', () => {
  let navController: NavigationController;

  beforeEach(() => {
    const context = new DummyControllerContext();
    const options: VerityControllerOptions = { contentAreaView: new DummyNavigationView() };
    navController = new NavigationController(context, options);
  });

  describe('constructor()', () => {
    it('should initialize with default values', () => {
      expect(Number.isNaN(navController.lastNavId)).toBe(false);
      expect(navController.controllerStack).toEqual([]);
      expect(navController.currentController).toBeUndefined();
    });

    it('should set parent.nav to itself', () => {
      expect(navController.parent.nav).toBe(navController);
    });
  });

  describe('show() method', () => {
    it('should instantiate and show a new controller if supplied with a class', async () => {
      const navItem: NavItem = {
        controller: DummyVerityController,
        navAction: DummyVerityController.prototype.navAction
      };

      await navController.show(navItem);
      expect(navController.controllerStack.length).toBe(1);
      // expect that the view was not asked to show a back button as there's only one controller
      expect((navController.contentAreaView as unknown as DummyNavigationView).backButton).toBe(false);
      const controller: DummyVerityController = navController.currentController as DummyVerityController;
      expect(controller).toBeInstanceOf(DummyVerityController);
      expect(controller.navActionCalled).toBe(true);
    });

    it('should close all controllers if navItem.exclusive is true', async () => {
      const previousNavItem: NavItem = {
        controller: DummyVerityController,
        navAction: DummyVerityController.prototype.navAction,
      };
      const navItem: NavItem = {
        controller: DummyVerityController,
        navAction: DummyVerityController.prototype.navAction,
        exclusive: true,
      };
      await navController.show(previousNavItem);
      await navController.show(previousNavItem);
      expect(navController.controllerStack.length).toBe(2);
      // expect that the view was asked to show a back button as there's more than one controller
      expect((navController.contentAreaView as unknown as DummyNavigationView).backButton).toBe(true);

      await navController.show(navItem);
      expect(navController.controllerStack.length).toBe(1);
      // expect that the view was not asked to show a back button as there's only one controller
      expect((navController.contentAreaView as unknown as DummyNavigationView).backButton).toBe(false);
    });
  });

  describe('makeNavItem() method', () => {
    it('should create a new navigation item with a unique ID', () => {
      const navItem: NavItem = {
        controller: DummyVerityController,
        navAction: DummyVerityController.prototype.navAction
      };
      const navs: NavItem[] = [];
      for (let i=0; i<100; i++) {
        const individualisedNav: NavItem = Object.assign({}, navItem)
        navs.push(individualisedNav);
        navController.makeNavItem(individualisedNav);
      }
      // expect all nav IDs to be unique by converting them to a set and
      // checking the size
      const navIds: string[] = navs.map(nav => nav.navId);
      const uniqueNavIds = new Set(navIds);
      expect(uniqueNavIds.size).toBe(100);
    });
  });

  describe('newControlLayer() method', () => {
    it('should add a new controller layer to the stack and mark it as active', () => {
      const layer: ControllerStackLayer = {
        controller: new DummyVerityController(navController.parent),
        navAction: DummyVerityController.prototype.navAction,
        navId: 'verityNav-1',
      };
      navController.newControlLayer(layer);
      expect(navController.controllerStack.length).toBe(1);
      expect(navController.currentControlLayer).toBe(layer);
      expect(navController.currentController).toBe(layer.controller);
    });
  });

  describe('closeCurrentController() method', () => {
    it('should close the current controller if the stack is not empty', () => {
      navController.newControlLayer({
        controller: new DummyVerityController(navController.parent),
        navAction: DummyVerityController.prototype.navAction
      });
      expect(navController.controllerStack.length).toBe(1);
      // expect that the view was not asked to show a back button as there's only one controller
      expect((navController.contentAreaView as unknown as DummyNavigationView).backButton).toBe(false);

      navController.closeCurrentController();
      expect(navController.controllerStack.length).toBe(0);
      // expect that the view was not asked to show a back button as there's no controllers at all
      expect((navController.contentAreaView as unknown as DummyNavigationView).backButton).toBe(false);

      expect(navController.currentController).toBeUndefined();
    });

    it('should do nothing if the stack is empty', () => {
      expect(navController.controllerStack.length).toBe(0);
      navController.closeCurrentController();
      expect(navController.controllerStack.length).toBe(0);
    });
  });

  describe('closeController() method', () => {
    it('should close the specified controller', () => {
      const controller = new DummyVerityController(navController.parent);
      const layer: ControllerStackLayer = {
        controller: controller,
        navAction: DummyVerityController.prototype.navAction,
        navId: 'verityNav-1',
      };
      navController.controllerStack.push(layer);
      navController.closeController(controller);
      expect(navController.controllerStack.length).toBe(0);
    });

    it('should do nothing if the controller is not on the stack', () => {
      navController.newControlLayer({
        controller: new DummyVerityController(navController.parent),
        navAction: DummyVerityController.prototype.navAction,
        navId: 'verityNav-1',
      });
      expect(navController.controllerStack.length).toBe(1);
      // expect that the view was not asked to show a back button as there's only one controller
      expect((navController.contentAreaView as unknown as DummyNavigationView).backButton).toBe(false);

      const controller = new DummyVerityController(navController.parent);
      navController.closeController(controller);
      expect(navController.controllerStack.length).toBe(1);
      // expect that the view was not asked to show a back button as there's only one controller
      expect((navController.contentAreaView as unknown as DummyNavigationView).backButton).toBe(false);
    });

    it.todo('should update the view if specified');
  });

  describe('closeAllControllers() method', () => {
    it('should close all controllers in the stack', () => {
      const controller1 = new DummyVerityController(navController.parent);
      const controller2 = new DummyVerityController(navController.parent);
      navController.newControlLayer({
        controller: controller1,
        navAction: DummyVerityController.prototype.navAction,
      });
      navController.newControlLayer({
        controller: controller2,
        navAction: DummyVerityController.prototype.navAction,
      });
      expect(navController.controllerStack.length).toBe(2);
      // expect that the view was asked to show a back button as there's more than one controller
      expect((navController.contentAreaView as unknown as DummyNavigationView).backButton).toBe(true);

      navController.closeAllControllers();
      expect(navController.controllerStack.length).toBe(0);
      // expect that the view was not asked to show a back button as there's no controllers at all
      expect((navController.contentAreaView as unknown as DummyNavigationView).backButton).toBe(false);
    });
  });

  describe('restartController() method', () => {
    it('should re-instantiate the specified controller', async () => {
      const controller = new DummyVerityController(navController.parent);
      const layer: ControllerStackLayer = {
        controller: controller,
        navAction: DummyVerityController.prototype.navAction,
        navId: 'verityNav-1',
      };
      navController.newControlLayer(layer);
      expect(navController.controllerStack.length).toBe(1);
      await navController.restartController(layer);
      expect(navController.controllerStack.length).toBe(1);
      expect(navController.currentController).toBeInstanceOf(DummyVerityController);
      expect(navController.currentController).not.toBe(controller);
      expect((navController.currentController as DummyVerityController).navActionCalled).toBe(true);
    });

    it.todo('should not re-instantiate the controller if it is included in the exclude list, but still re-trigger the nav action');
  });

  describe('identityChanged() method', () => {
    it("should notify all controllers of identity change and restart them if they don't handle the event", async () => {
      const initialControllerInstance = new DummyVerityController(navController.parent);
      const layer1: ControllerStackLayer = {
        controller: initialControllerInstance,
        navAction: DummyVerityController.prototype.navAction,
      };
      const layer2: ControllerStackLayer = {
        controller: initialControllerInstance,
        navAction: DummyVerityController.prototype.navAction,
      };
      const layer3: ControllerStackLayer = {
        controller: initialControllerInstance,
        navAction: DummyVerityController.prototype.navAction,
      };
      navController.newControlLayer(layer1);
      navController.newControlLayer(layer2);
      navController.newControlLayer(layer3);
      expect(navController.controllerStack.length).toBe(3);
      expect(navController.controllerStack[0].controller).toBe(initialControllerInstance);
      expect(navController.controllerStack[1].controller).toBe(initialControllerInstance);
      expect(navController.controllerStack[2].controller).toBe(initialControllerInstance);

      await navController.identityChanged();

      expect(navController.controllerStack.length).toBe(3);
      expect(navController.controllerStack[0].controller).toBeInstanceOf(DummyVerityController);
      expect(navController.controllerStack[1].controller).toBeInstanceOf(DummyVerityController);
      expect(navController.controllerStack[2].controller).toBeInstanceOf(DummyVerityController);
      expect(navController.controllerStack[0].controller).not.toBe(initialControllerInstance);
      expect(navController.controllerStack[1].controller).not.toBe(initialControllerInstance);
      expect(navController.controllerStack[2].controller).not.toBe(initialControllerInstance);
      expect((navController.controllerStack[0].controller as DummyVerityController).navActionCalled).toBe(true);
      expect((navController.controllerStack[1].controller as DummyVerityController).navActionCalled).toBe(true);
      expect((navController.controllerStack[2].controller as DummyVerityController).navActionCalled).toBe(true);
    });

    it.todo("should not restart controllers that handle the event");
  });
});
