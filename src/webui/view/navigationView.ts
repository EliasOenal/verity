import { NavItem } from "../controller/navigationController";
import { VerityView } from "./verityView";

export class NavigationView extends VerityView {
  constructor() {
    super(undefined, document.getElementById("verityNavbar"));
    this.renderedView = document.createElement('div');
  }

  makeNavItem(navItem: NavItem): void {
    // create nav container li
    const navLi: HTMLLIElement = document.createElement("li");
    navLi.className = "nav-item";
    navLi.id = `verityNav-${navItem.controller}.${navItem.navAction}`;
    // create nav link
    const navLink: HTMLAnchorElement = document.createElement("a");
    navLink.href = "#";
    navLink.className = "nav-link";
    navLink.addEventListener('click', () =>
      window.verity.nav.showNew(navItem));
    navLink.textContent = navItem.text ??  // provide default if no text specified
      `${navItem.controller} ${navItem.navAction}`;
    // add new nav item to navbar
    navLi.appendChild(navLink);
    this.renderedView.appendChild(navLi);
  }

  navbarMarkActive(id: string) {
    for (const nav of this.renderedView.getElementsByClassName("nav-item")) {
      if (nav.id == id) nav.classList.add("active");
      else nav.classList.remove("active");
    }
  }

  // HACKHACK: These methods manipulates the DOM outside this view's
  // self-declared viewArea (which is the navbar).
  // The also always manipulate the live DOM rather than our renderedView,
  // therefore ignoring show() and unshow() requests.
  displayBackButton(): void {
    const backArea = document.getElementById("verityBackArea");
    backArea.setAttribute("style", "display: block");
  }

  hideBackButton(): void {
    const backArea = document.getElementById("verityBackArea");
    backArea.setAttribute("style", "display: none");
  }
}
