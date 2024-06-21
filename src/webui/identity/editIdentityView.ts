import { Identity } from "../../cci/identity/identity";
import { VerityView } from "../verityView";

import type { IdentityController } from "./identityController";

export class EditIdentityView extends VerityView {
  constructor(
    controller: IdentityController,
    htmlTemplate: HTMLTemplateElement = document.getElementById(
      "verityEditIdentityTemplate") as HTMLTemplateElement,
  ){
    super(controller, htmlTemplate);

    const displayNameInput: HTMLInputElement =
      this.renderedView.querySelector(".verityDisplayNameInput");
    displayNameInput.value = this.controller.identity.name;
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
