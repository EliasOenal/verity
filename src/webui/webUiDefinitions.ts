import { VerityError } from "../core/settings";

export abstract class VerityController {
  constructor(
    public view: VerityView) {
  }
}

export abstract class VerityView {
  protected renderedView: HTMLDivElement;

  constructor(
    protected viewArea: HTMLElement = document.getElementById("verityContentArea")
  ) {
    if (!this.viewArea) throw new UiError("VerityView: Cannot create a view without a view area");
  }

  show() {
    this.viewArea.replaceChildren(this.renderedView);
  }

  shutdown() {
    // to be implemented by subclass, if needed
  }
}

class UiError extends VerityError { }