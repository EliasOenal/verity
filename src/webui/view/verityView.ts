import { UiError } from "../webUiDefinitions";

// TODO: make template handling more clearly optional
/** Abstract base class for our views */
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

  /**
   * Shows this view's content by placing it in it's content area.
   * Subclasses should usually *not* override this. Please prepare all your
   * content beforehand, so that show() really only has to show it.
   **/
  show(exclusive: boolean = true) {
    if (exclusive) {
      this.viewArea.replaceChildren(this.renderedView);
    } else {
      this.viewArea.prepend(this.renderedView);
    }
  }

  /**
   * Temporarily removes this view's content.
   * Afterwards, calling show() should get the user right back to where they
   * left off.
   **/

  unshow() {
    this.viewArea.removeChild(this.renderedView);
  }

  /**
   * Terminates this view, including any teardown tasks that might be
   * necessary. A view that has been shut down can never be shown again; a new
   * view must be constructed instead.
   */
  shutdown() {
    // To be replaced or extended by subclass as needed.
    this.unshow();
  }

  newFromTemplate(templateQuery: string): HTMLElement {
    const templateEntry: HTMLElement =
      this.htmlTemplate.content.querySelector(templateQuery);
    const entry: HTMLElement = templateEntry.cloneNode(true) as HTMLElement;
    return entry;
  }
}

