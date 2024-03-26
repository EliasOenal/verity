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

  newController(controller: VerityController) {
    this.controllerStack.push(controller);
    this.displayOrHideBackButton();
  }

  closeCurrentController() {
    if (this.currentController !== undefined) {
      this.currentController.close();
      this.controllerStack.pop();
      this.displayOrHideBackButton();
      if (this.currentController !== undefined) {
        this.currentController.contentAreaView.show();
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
    this.navbarMarkActive("navPostsAll");
    const annotationEngine = new ZwAnnotationEngine(
      this.ui.node.cubeStore,
      SubscriptionRequirement.none,  // show all posts
      [],       // subscriptions don't play a role in this mode
      true,     // auto-learn MUCs to display authorship info if available
      true);    // allow anonymous posts
    const controller = new PostController(this.ui.node.cubeStore, annotationEngine, this.ui.identity);
    this.newController(controller);
  }

  navPostsWithAuthors(): void {
    this.closeAllControllers();
    logger.trace("VerityUI: Displaying posts associated with a MUC");
    this.navbarMarkActive("navPostsWithAuthors");
    const annotationEngine = new ZwAnnotationEngine(
      this.ui.node.cubeStore,
      SubscriptionRequirement.none,
      [],       // no subscriptions as they don't play a role in this mode
      true,     // auto-learn MUCs (posts associated with any Identity MUC are okay)
      false);   // do not allow anonymous posts
    const controller = new PostController(this.ui.node.cubeStore, annotationEngine, this.ui.identity);
    this.newController(controller);
  }

  navPostsSubscribedInTree(): void {
    if (!this.ui.identity) return;
    this.closeAllControllers();
    logger.trace("VerityUI: Displaying posts from trees with subscribed author activity");
    this.navbarMarkActive("navPostsSubscribedInTree");
    const annotationEngine = new ZwAnnotationEngine(
      this.ui.node.cubeStore,
      SubscriptionRequirement.subscribedInTree,
      this.ui.identity.subscriptionRecommendations,  // subscriptions
      true,      // auto-learn MUCs (to be able to display authors when available)
      false);    // do not allow anonymous posts
    const controller = new PostController(this.ui.node.cubeStore, annotationEngine, this.ui.identity);
    this.newController(controller);
  }

  navPostsSubscribedReplied(wotDepth: number = 0): void {
    if (!this.ui.identity) return;
    this.closeAllControllers();
    logger.trace("VerityUI: Displaying posts from subscribed authors and their preceding posts");
    let navName: string = "navPostsSubscribedReplied";
    if (wotDepth) navName += wotDepth;
    this.navbarMarkActive(navName);
    const annotationEngine = new ZwAnnotationEngine(
      this.ui.node.cubeStore,
      SubscriptionRequirement.subscribedReply,
      this.ui.identity.recursiveWebOfSubscriptions(wotDepth),  // subscriptions
      true,      // auto-learn MUCs (to be able to display authors when available)
      false);    // do not allow anonymous posts
    const controller = new PostController(this.ui.node.cubeStore, annotationEngine, this.ui.identity);
    this.newController(controller);
  }

  navPostsSubscribedStrict(): void {
    if (!this.ui.identity) return;
    this.closeAllControllers();
    logger.trace("VerityUI: Displaying posts from subscribed authors strictly");
    this.navbarMarkActive("navPostsSubscribedStrict");
    const annotationEngine = new ZwAnnotationEngine(
      this.ui.node.cubeStore,
      SubscriptionRequirement.subscribedOnly,  // strictly show subscribed
      this.ui.identity.subscriptionRecommendations,  // subscriptions
      false,     // do no auto-learn MUCs (strictly only posts by subscribed will be displayed)
      false);    // do not allow anonymous posts
    const controller = new PostController(this.ui.node.cubeStore, annotationEngine, this.ui.identity);
    this.newController(controller);
  }

  navPeers() {
    this.newController(this.ui.peerController);
    this.ui.peerController.contentAreaView.show();
    this.navbarMarkActive("navPeers");
  }

  navCubeExplorer(): void {
    this.navbarMarkActive("navCubeExplorer");
    const controller = new CubeExplorerController(this.ui.node.cubeStore);
    this.newController(controller);
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