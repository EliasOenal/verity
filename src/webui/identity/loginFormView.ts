import { VerityView } from "../verityView";
import type { IdentityController } from "./identityController";

export class LoginFormView extends VerityView {
  declare controller: IdentityController;

  constructor(
      controller: IdentityController,
      htmlTemplate: HTMLTemplateElement = document.getElementById(
        "verityLoginFormTemplate") as HTMLTemplateElement,

  ){
    super(controller, htmlTemplate);
    this.setEventHandlers();
  }

  private setEventHandlers(): void {
    // Password login form
    const passwordForm: HTMLFormElement = this.renderedView.querySelector(
      ".verityLoginPasswordForm");
    passwordForm.addEventListener("submit", (event) => {
      event.preventDefault();
      this.controller.performPasswordLogin(passwordForm);
    });

    // Bip39 login form
    const bip39Form: HTMLFormElement = this.renderedView.querySelector(
      ".verityLoginBip39Form");
    bip39Form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.controller.performBip39Login(bip39Form);
    });
  }
}