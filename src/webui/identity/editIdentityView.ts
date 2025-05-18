import type { IdentityController } from "./identityController";
import { VerityView } from "../verityView";

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

    this.displayAvatar();
    this.displayBip39();
  }

  displayAvatar(
      seed: string = this.controller.identity?.avatar?.seedString,
      src: string = this.controller.identity?.avatar?.render?.(),
  ) {
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

  displayBip39() {
    const phraseElem: HTMLInputElement = this.renderedView.querySelector(
      ".verityEditIdentityBip39Phrase");
    const phrase = this.controller.identity.recoveryPhrase;
    phraseElem.textContent = phrase;
  }
}
