import { VerityError } from "../core/settings";

export abstract class VerityController {
}

export abstract class VerityView {
  protected viewArea: HTMLElement;

  constructor(
    viewArea = document.getElementById("verityContentArea")
  ) {
    this.viewArea = viewArea;
  }

  show() {
    // to be implemented by subclass
  }

  shutdown() {
    // to be implemented by subclass, if needed
  }
}