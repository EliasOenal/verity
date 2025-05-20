import { Identity } from "../../cci/identity/identity";
import { VerityView } from "../verityView";
import type { IdentityController } from "./identityController";

export class LoginStatusView extends VerityView {
  declare readonly controller: IdentityController;

  constructor(
      controller: IdentityController,
      htmlTemplate: HTMLTemplateElement = document.getElementById(
        "verityIdentityRowTemplate") as HTMLTemplateElement,
      viewArea: HTMLElement = document.getElementById("verityIdentityArea"),
  ){
    super(controller, htmlTemplate, viewArea);
  }

  renderLoggedOut(show: boolean = false): void {
    // reset info area to not logged in
    const infoArea = this.renderedView.querySelector(".verityMyIdentityInfoArea");
    infoArea.replaceChildren(this.newFromTemplate(".verityNotLoggedIn"));
    // remove profile pic
    const profilePicElem:  HTMLImageElement = (this.renderedView.querySelector(
      ".verityIdentityAvatar")) as HTMLImageElement;
    profilePicElem.src = "unknownuser.svg";
    this.setLinkTargets();
    if (show) this.show();
  }

  renderLoggedIn(identity: Identity, show: boolean = false): void {
    // select the logged in version of the template
    const infoArea = this.renderedView.querySelector(".verityMyIdentityInfoArea");
    const infoDiv: HTMLElement = this.newFromTemplate(".verityMyIdentityInfo");
    const usernameElem: HTMLElement =
      infoDiv.querySelector(".verityIdentityDisplayname") as HTMLElement;
    usernameElem.textContent = identity.name;
    usernameElem.setAttribute("title", "MUC key " + identity.keyString);
    // show profile pic
    const profilePicElem:  HTMLImageElement = (this.renderedView.querySelector(
      ".verityIdentityAvatar")) as HTMLImageElement;
    profilePicElem.src = identity.avatar.render();
    infoArea.replaceChildren(infoDiv);
    this.setLinkTargets();
    if (show) this.show();
  }

  private setLinkTargets() {
    const loginLink: HTMLAnchorElement =
      this.renderedView.querySelector('.verityIdentityLoginLink');
    if (loginLink) {
      loginLink.onclick = () => this.controller.parent.nav.show({
        controller: this.controller,
        navAction: this.controller.selectLoginForm
      });
    }

    const editLink: HTMLAnchorElement =
      this.renderedView.querySelector('.verityIdentityEditLink')
    if (editLink) {
      editLink.onclick = () => this.controller.parent.nav.show({
        controller: this.controller,
        navAction: this.controller.selectEditForm
      });
    }

    const logoutLink: HTMLAnchorElement =
      this.renderedView.querySelector('.verityIdentityLogoutLink')
    if (logoutLink) {
      logoutLink.onclick = () => {
        this.controller.logOut();
      }
    }
  }
}