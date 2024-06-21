import { VerityView } from "../verityView";
import type { IdentityController } from "./identityController";

export class LoginFormView extends VerityView {
  constructor(
      controller: IdentityController,
      htmlTemplate: HTMLTemplateElement = document.getElementById(
        "verityLoginFormTemplate") as HTMLTemplateElement,

  ){
    super(controller, htmlTemplate);
  }

}