import { NavigationController } from "./navigationController";
import { VerityView } from "../verityView";

import type { NavItem } from "./navigationDefinitions";

export interface NavigationViewIf {
  makeNavItem(navItem: NavItem): void;
  navbarMarkActive(id: string): void;
  displayBackButton(): void;
  hideBackButton(): void;
}

/** Mock for testing only */
export class DummyNavigationView extends VerityView implements NavigationViewIf {
  backButton: boolean;
  constructor() { super(undefined, undefined, null) }
  makeNavItem(navItem: NavItem): void {}
  navbarMarkActive(id: string): void {}
  displayBackButton(): void { this.backButton = true }
  hideBackButton(): void { this.backButton = false }
}

export class NavigationView extends VerityView implements NavigationViewIf {
  declare readonly controller: NavigationController
  constructor(
    controller: NavigationController
  ) {
    super(controller, undefined, document.getElementById("verityNavbar"));
    this.renderedView = document.createElement('div');
  }

  makeNavItem(navItem: NavItem): void {
    // create nav container li
    const navLi: HTMLLIElement = document.createElement("li");
    navLi.className = "nav-item";
    navLi.id = navItem.navId;
    // create nav link
    const navLink: HTMLAnchorElement = document.createElement("a");
    navLink.href = "#";
    navLink.className = "nav-link";
    navLink.addEventListener('click', () =>
      this.controller.show(navItem, true));
    navLink.textContent = navItem.text ??  // provide default if no text specified
      `${navItem.controller} ${navItem.navAction}`;
    // add new nav item to navbar
    navLi.appendChild(navLink);
    this.renderedView.appendChild(navLi);
  }

  navbarMarkActive(id: string): void {
    for (const nav of this.renderedView.getElementsByClassName("nav-item")) {
      if (nav.id === id) nav.classList.add("active");
      else nav.classList.remove("active");
    }
  }

  // HACKHACK: These methods manipulates the DOM outside this view's
  // self-declared viewArea (which is the navbar).
  // It also always manipulate the live DOM rather than our renderedView,
  // therefore ignoring show() and unshow() requests.
  // To fix this, we could either move the back button to the navbar
  // or create a new view for the back button.
  displayBackButton(): void {
    const backArea = document.getElementById("verityBackArea");
    backArea.setAttribute("style", "display: block");
  }

  hideBackButton(): void {
    const backArea = document.getElementById("verityBackArea");
    backArea.setAttribute("style", "display: none");
  }
}
