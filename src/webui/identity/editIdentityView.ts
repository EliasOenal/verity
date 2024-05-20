import { Identity } from "../../cci/identity/identity";
import { VerityView } from "../verityView";

export class EditIdentityView extends VerityView {
  constructor(
    identity: Identity,
    htmlTemplate: HTMLTemplateElement = document.getElementById(
      "verityEditIdentityTemplate") as HTMLTemplateElement,
  ){
    super(htmlTemplate);

    const displayNameInput: HTMLInputElement =
      this.renderedView.querySelector(".verityDisplayNameInput");
    displayNameInput.value = identity.name;
  }

  displayAvatar(seed: string, src: string) {
    const imgElem: HTMLImageElement = this.renderedView.querySelector(
      "img.verityEditIdentityAvatar");
    if (!imgElem) return;
    const seedElem: HTMLInputElement = this.renderedView.querySelector(
      ".verityEditIdentityAvatarSeed");
    if (!seedElem) return;
    imgElem.src = src;
    if (seed) seedElem.value = seed;
    else seedElem.value = "";
  }
}
