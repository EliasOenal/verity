import { UiError } from "./webUiDefinitions";
import { logger } from "../core/logger";
import type { VerityController } from "./verityController";

// TODO: make template handling more clearly optional

export const alertTypes =
  ['primary', 'secondary', 'success', 'danger', 'warning', 'info', 'light', 'dark'] as const;
export type AlertTypeList = typeof alertTypes[number];

/**
 * Abstract base class for our views.
 *
 * Advice for implementing subclasses:
 * - Methods should be grouped by purpose and ordered like this:
 *   1) Primary View assembly methods
 *      Each of these should assemble an entire view and are usually called
 *      by the controller. Their name should always start with "view".
 *   2) Secondary View assembly methods
 *      Those are called by the primary view assembly methods but can also be
 *      called by the controller to update parts of the view
 *   3) DOM manipulation actions
 *      These are called directly as event handlers from the view and only
 *      manipulate the view, e.g. toggle collapsibles, add or remove elements,
 *      etc.
 *   4) Input validation methods
 *      For views accepting inputs, those provide preliminary input validation
 *      before inputs are submitted. They may also be called by the controller,
 *      for example when a submit action is triggered (and refused, probably).
 *   5) Conversion methods: Model to view
 *      Methods that convert model data to view elements
 *   6) Conversion methods: View to model
 *      Methods that convert view elements to model data, e.g. input retrieval.
 *   7) Local helper methods
 *      Methods only used from within this view, which should be marked private.
 **/
export class VerityView {
  renderedView: HTMLElement;

  constructor(
    readonly controller: VerityController,
    readonly htmlTemplate: HTMLTemplateElement,
    readonly viewArea: HTMLElement = document.getElementById("verityContentArea")
  ) {
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
      this.viewArea?.replaceChildren(this.renderedView);
    } else {
      this.viewArea?.prepend(this.renderedView);
    }
  }

  /**
   * Temporarily removes this view's content.
   * Afterwards, calling show() should get the user right back to where they
   * left off.
   **/
  unshow() {
    this.renderedView?.remove();
  }

  /**
   * Terminates this view, including any teardown tasks that might be
   * necessary. A view that has been shut down can never be shown again; a new
   * view must be constructed instead.
   */
  shutdown(unshow: boolean = true) {
    // To be replaced or extended by subclass as needed.
    if (unshow) this.unshow();
  }

  newFromTemplate(templateQuery: string): HTMLElement {
    if (!this.htmlTemplate) throw new UiError("VerityView.newFromTemplate(): No template defined");
    const templateEntry: HTMLElement =
      this.htmlTemplate.content.querySelector(templateQuery);
    const entry: HTMLElement = templateEntry.cloneNode(true) as HTMLElement;
    return entry;
  }

  /**
   * Displays an alert on top or instead of the Cube's details.
   * For consistency, you should always use this method to display errors,
   * warnings, or other important messages to the user.
   * @param container - The HTMLElement within which the alert should be
   *   displayed. All other content will be removed from this container.
   * @param type - A Bootstrap alert type, e.g. "danger" for an error
   * @param msg - The message to display in the alert
   * @param exclusive - If true, all other alerts will be cleared from the
   *   entire renderedView.
   * @returns The HTMLElement containing the alert
   */
  makeAlert(
      container: HTMLElement | string | null,
      type: AlertTypeList,
      msg: string,
      exclusive: boolean = false,
  ): HTMLElement {
    if (exclusive) this.clearAlerts();
    if (typeof container === 'string') {
      container = this.renderedView.querySelector(container) as HTMLElement;
      if (!container) logger.error(`VerityView.makeAlert(): Container ${container} does not exist. Will create a new one for you, but this will obviously not be part of the DOM.`);
    }
    if (!container) {
      container = document.createElement("div");
    }
    container.classList.add("verityAlert", "alert", "alert-"+type);
    container.setAttribute("role", "alert");
    container.textContent = msg;
    return container;
  }

  clearAlerts(where: HTMLElement | string = this.renderedView): void {
    if (typeof where === 'string') {
      where = this.renderedView.querySelector(where) as HTMLElement;
    }
    const alerts: NodeListOf<HTMLElement> = where.querySelectorAll(".verityAlert");
    for (const alert of alerts) {
      alert.classList.remove("verityAlert", "alert");
      for (const alertType of alertTypes) alert.classList.remove("alert-"+alertType);
      alert.removeAttribute("role");
      alert.textContent = '';
    }
  }
}

