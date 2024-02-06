import { VerityError } from "../core/settings";

export abstract class VerityController {
  constructor(
    public view: VerityView) {
  }
}

// TODO: make template handling more clearly optional
export abstract class VerityView {
  protected renderedView: HTMLElement;

  constructor(
    protected htmlTemplate: HTMLTemplateElement,
    protected viewArea: HTMLElement = document.getElementById("verityContentArea")
  ) {
    if (!this.viewArea) throw new UiError("VerityView: Cannot create a view without a view area");
    if (htmlTemplate) this.renderedView =
      this.htmlTemplate.content.firstElementChild.cloneNode(true) as HTMLElement;
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

  newEntry(templateQuery: string): HTMLElement {
    const templateEntry: HTMLElement =
      this.htmlTemplate.content.querySelector(templateQuery);
    const entry: HTMLElement = templateEntry.cloneNode(true) as HTMLElement;
    return entry;
  }
}

class UiError extends VerityError { }