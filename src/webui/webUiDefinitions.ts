import { VerityError } from "../core/settings";

export abstract class VerityController {
  constructor(
    public view: VerityView) {
  }
}

export abstract class VerityView {
  protected renderedView: HTMLElement;

  constructor(
    protected viewArea: HTMLElement = document.getElementById("verityContentArea")
  ) {
    if (!this.viewArea) throw new UiError("VerityView: Cannot create a view without a view area");
  }

  show(exclusive: boolean = true) {
    if (exclusive) {
      this.viewArea.replaceChildren(this.renderedView);
    } else {
      this.viewArea.prepend(this.renderedView);
    }
  }
  unshow() {
    this.renderedView.removeChild(this.renderedView);
  }

  shutdown() {
    // To be replaced or extended by subclass as needed.
    this.unshow();
  }
}

class UiError extends VerityError { }