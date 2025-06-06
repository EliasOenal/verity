import { VerityController } from "../verityController";

/**
 * A dataset describing a navigation item, e.g. a link in the navigation bar.
 * The actual link will be created by the NavController by calling makeNavItem()
 * and supplying this dataset.
 **/
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

/**
 * A dataset describing a controller layer in the controller stack.
 * The controller stack is used to keep track of the controllers currently
 * managing the content area of the VerityUI.
 * For example, if the user opens a list of posts, PostController will be the
 * active controller currently controlling the view. If the user then clicks
 * on their profile edit link, Identity controller will become the active
 * controller, but PostController will still be in the controller stack.
 * This way, the user can easily return to the list of posts by clicking the
 * back button and return exactly to where they left off.
 **/
export interface ControllerStackLayer extends NavItem {
  /**
   * The VerityController managing this view.
   * In contrast to NavItem, this is now definitely an instance rather than a class.
   **/
  controller: VerityController;
};

export interface NavControllerIf {
  show(navItem: NavItem, show?: boolean): Promise<void>;
  closeController(controllerStackIndex: VerityController | number, updateView?: boolean): void;
  identityChanged(): Promise<boolean>;
}
