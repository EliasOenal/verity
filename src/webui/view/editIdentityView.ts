import { Identity } from "../../cci/identity";
import { VerityView } from "./verityView";

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

}
