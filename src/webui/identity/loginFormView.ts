import { VerityView } from "../verityView";

export class LoginFormView extends VerityView {
  constructor(
      htmlTemplate: HTMLTemplateElement = document.getElementById(
        "verityLoginFormTemplate") as HTMLTemplateElement,

  ){
    super(htmlTemplate);
  }

}