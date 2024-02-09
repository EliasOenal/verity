import { Identity } from "../../cci/identity";
import { VerityView } from "./verityView";

export class LoginStatusView extends VerityView {
  constructor(
      htmlTemplate: HTMLTemplateElement = document.getElementById(
        "verityIdentityRowTemplate") as HTMLTemplateElement,
      viewArea: HTMLElement = document.getElementById("verityIdentityArea"),
  ){
    super(htmlTemplate, viewArea);
  }

  showNotLoggedIn(): void {
    // reset info area to not logged in
    const infoArea = this.renderedView.querySelector(".verityMyIdentityInfoArea");
    infoArea.replaceChildren(this.newFromTemplate(".verityNotLoggedIn"));
    // remove profile pic
    const profilePicElem:  HTMLImageElement = (this.renderedView.querySelector(
      ".verityMyProfilePic")) as HTMLImageElement;
    profilePicElem.src = "unknownuser.svg";
    this.show();
  }

  showLoggedIn(identity: Identity): void {
    // select the logged in version of the template
    const infoArea = this.renderedView.querySelector(".verityMyIdentityInfoArea");
    const infoDiv: HTMLElement = this.newFromTemplate(".verityMyIdentityInfo");
    const usernameElem: HTMLElement =
      infoDiv.querySelector(".verityMyIdentityDisplayname") as HTMLElement;
    usernameElem.innerText = identity.name;
    usernameElem.setAttribute("title", "MUC key " + identity.keyString);
    // show profile pic
    const profilePicElem:  HTMLImageElement = (this.renderedView.querySelector(
      ".verityMyProfilePic")) as HTMLImageElement;
    profilePicElem.src = identity.profilePic;
    infoArea.replaceChildren(infoDiv);
    this.show();
  }
}