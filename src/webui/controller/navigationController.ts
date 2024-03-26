import { VerityUI } from "../verityUI";
import { ZwAnnotationEngine, SubscriptionRequirement } from "../../app/zwAnnotationEngine";
import { VerityController } from "./verityController";
import { PostController } from "./postController";
import { CubeExplorerController } from "./cubeExplorerController";

import { logger } from "../../core/logger";

/**
 * The NavigationController is a special one, as it not only controls
 * the navigation bar but also owns and controls all other Controllers.
 * Maybe it's even a stretch calling the NavigationController a controller,
 * perhaps NavigationGrandmaster would have been more appropriate.
 **/
export class NavigationController extends VerityController {
  /**
   * The stack of active controllers for verityContentArea.
   * The top one always has control and can conveniently be retrieved by
   * accessing currentController instead.
   **/
  controllerStack: VerityController[] = [];
  /**
   * For each controller in controllerStack, this remembers the associated
   * active nav bar item. It there is no associated active nav bar item, we explicitly
   * put undefined on the stack, which means all nav bar items marked inactive.
   */
  navIdStack: string[] = [];

  constructor(
    /**
     * Owing to the NavigationControllers special role as basically being an
     * extension to VerityUI it is tightly coupled to it, in contrast to
     * regular types of controllers.
     **/
    public ui: VerityUI,
   ){
    super();
  }

  /**
   * The controller currently owning verityContentArea.
   * This is always to top controller on the controllerStack; and we will
   * conveniently display a back button to close it and return control to the
   * one below :)
  **/
  get currentController(): VerityController {
    if (this.controllerStack.length === 0) return undefined;
    else return this.controllerStack[this.controllerStack.length-1];
  }

  newController(controller: VerityController, navBarItemId: string = undefined) {
    this.controllerStack.push(controller);  // Remember this controller and
    this.navIdStack.push(navBarItemId);     // the associated nav bar item (if any).
    this.displayOrHideBackButton();  // Only show back button if there's something to go back to.
    this.navbarMarkActive(navBarItemId);  // Update active nav bar item.
  }

  closeCurrentController() {
    if (this.currentController !== undefined) {
      this.currentController.close();  // Close controller
      this.controllerStack.pop();      // and remove it from stack.
      this.displayOrHideBackButton();  // Only show back button if there's something to go back to.
      if (this.currentController !== undefined) {
        this.currentController.contentAreaView.show();
      }
      this.navIdStack.pop();
      if (this.navIdStack.length > 0) {  // should always be true
        this.navbarMarkActive(this.navIdStack[this.navIdStack.length-1]);  // Update active nav bar item.
      }
    }
  }

  closeAllControllers() {
    while(this.currentController !== undefined) {
      this.closeCurrentController();
    }
  }

  private displayOrHideBackButton() {
    // HACKHACK: UI code should be encapsulated somewhere, e.g. in a View...
    const backArea = document.getElementById("verityBackArea");
    if (this.controllerStack.length > 1) backArea.setAttribute("style", "display: block");
    else backArea.setAttribute("style", "display: none");
  }

  navPostsAll(): void {
    this.closeAllControllers();
    logger.trace("VerityUI: Displaying all posts including anonymous ones");
    const annotationEngine = new ZwAnnotationEngine(
      this.ui.node.cubeStore,
      SubscriptionRequirement.none,  // show all posts
      [],       // subscriptions don't play a role in this mode
      true,     // auto-learn MUCs to display authorship info if available
      true);    // allow anonymous posts
    const controller = new PostController(this.ui.node.cubeStore, annotationEngine, this.ui.identity);
    this.newController(controller, "navPostsAll");
  }

  navPostsWithAuthors(): void {
    this.closeAllControllers();
    logger.trace("VerityUI: Displaying posts associated with a MUC");
    const annotationEngine = new ZwAnnotationEngine(
      this.ui.node.cubeStore,
      SubscriptionRequirement.none,
      [],       // no subscriptions as they don't play a role in this mode
      true,     // auto-learn MUCs (posts associated with any Identity MUC are okay)
      false);   // do not allow anonymous posts
    const controller = new PostController(this.ui.node.cubeStore, annotationEngine, this.ui.identity);
    this.newController(controller, "navPostsWithAuthors");
  }

  navPostsSubscribedInTree(): void {
    if (!this.ui.identity) return;
    this.closeAllControllers();
    logger.trace("VerityUI: Displaying posts from trees with subscribed author activity");
    const annotationEngine = new ZwAnnotationEngine(
      this.ui.node.cubeStore,
      SubscriptionRequirement.subscribedInTree,
      this.ui.identity.subscriptionRecommendations,  // subscriptions
      true,      // auto-learn MUCs (to be able to display authors when available)
      false);    // do not allow anonymous posts
    const controller = new PostController(this.ui.node.cubeStore, annotationEngine, this.ui.identity);
    this.newController(controller, "navPostsSubscribedInTree");
  }

  navPostsSubscribedReplied(wotDepth: number = 0): void {
    if (!this.ui.identity) return;
    this.closeAllControllers();
    logger.trace("VerityUI: Displaying posts from subscribed authors and their preceding posts");
    let navName: string = "navPostsSubscribedReplied";
    if (wotDepth) navName += wotDepth;
    const annotationEngine = new ZwAnnotationEngine(
      this.ui.node.cubeStore,
      SubscriptionRequirement.subscribedReply,
      this.ui.identity.recursiveWebOfSubscriptions(wotDepth),  // subscriptions
      true,      // auto-learn MUCs (to be able to display authors when available)
      false);    // do not allow anonymous posts
    const controller = new PostController(this.ui.node.cubeStore, annotationEngine, this.ui.identity);
    this.newController(controller, navName);
  }

  navPostsSubscribedStrict(): void {
    if (!this.ui.identity) return;
    this.closeAllControllers();
    logger.trace("VerityUI: Displaying posts from subscribed authors strictly");
    const annotationEngine = new ZwAnnotationEngine(
      this.ui.node.cubeStore,
      SubscriptionRequirement.subscribedOnly,  // strictly show subscribed
      this.ui.identity.subscriptionRecommendations,  // subscriptions
      false,     // do no auto-learn MUCs (strictly only posts by subscribed will be displayed)
      false);    // do not allow anonymous posts
    const controller = new PostController(this.ui.node.cubeStore, annotationEngine, this.ui.identity);
    this.newController(controller, "navPostsSubscribedStrict");
  }

  navPeers() {
    this.newController(this.ui.peerController, "navPeers");
    this.ui.peerController.contentAreaView.show();
  }

  navCubeExplorer(): void {
    const controller = new CubeExplorerController(this.ui.node.cubeStore);
    this.newController(controller, "navCubeExplorer");
    controller.redisplay();
    controller.contentAreaView.show();
  }

  private navbarMarkActive(id: string) {
    for (const nav of document.getElementsByClassName("nav-item")) {
      if (nav.id == id) nav.classList.add("active");
      else nav.classList.remove("active");
    }
  }
}