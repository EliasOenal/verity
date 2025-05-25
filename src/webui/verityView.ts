import { UiError } from "./webUiDefinitions";
import { logger } from "../core/logger";
import type { VerityController } from "./verityController";

// TODO: make template handling more clearly optional

export const alertTypes =
  ['primary', 'secondary', 'success', 'danger', 'warning', 'info', 'light', 'dark'] as const;
export type AlertTypeList = typeof alertTypes[number];

export interface MakeAlertOptions {
  container?: HTMLElement | string;
  type?: AlertTypeList;
  exclusive?: boolean;
}

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
    readonly htmlTemplate?: HTMLTemplateElement,
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
    if (!this.viewArea) {
      logger.error("VerityView.show(): No view area defined");
      return;
    }
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
      msg: string,
      options: MakeAlertOptions = {},
  ): HTMLElement {
    // set default options
    options.type ??= 'warning';

    // If the alert container was supplied as a query string, find the
    // actual container element.
    if (typeof options.container === 'string') {
      const constainerQueryString = options.container;
      options.container = this.renderedView.querySelector(
        constainerQueryString) as HTMLElement;
        if (!options.container) logger.warn(`VerityView.makeAlert(): Container ${constainerQueryString} does not exist. Will create a default one for you.`);
    }
    // If no alert container was specified at all (or it was not found),
    // try to select a default container
    if (!options.container) {
      // try to find a default one
      for (const optString of [".verityMessageTop", ".verityMessageBottom"]) {
        options.container = this.renderedView.querySelector(optString) as HTMLElement;
        if (options.container) break;
      }
    }
    // If we stil don't have a container, create one.
    if (!options.container) {
      options.container = document.createElement("div");
      // Find a good place to find the container in the DOM:
      // After the first h1 or h2:
      const firstHeader: HTMLElement = this.renderedView.querySelector("h1, h2");
      if (firstHeader) {
        firstHeader.insertAdjacentElement("afterend", options.container);
      } else {
        // Or just at the very beginning of the content area:
        this.renderedView.insertAdjacentElement("afterbegin", options.container);
      }
    }

    // If the alert is supposed to be exclusive, clear all other alerts
    if (options.exclusive) this.clearAlerts();

    // Finally, create the alert
    options.container.classList.add("verityAlert", "alert", "alert-"+options.type);
    options.container.setAttribute("role", "alert");
    options.container.textContent = msg;
    return options.container;
  }

  clearAlerts(where: HTMLElement | string = this.renderedView): void {
    if (typeof where === 'string') {
      where = this.renderedView.querySelector(where) as HTMLElement;
    }
    // Fetch all alerts within this container...
    const alerts: Array<HTMLElement> = Array.from(where.querySelectorAll(".verityAlert"));
    // ... including the container itself, if the container itself is an alert.
    if (where.matches(".verityAlert")) alerts.unshift(where);
    for (const alert of alerts) {
      alert.classList.remove("verityAlert", "alert");
      for (const alertType of alertTypes) alert.classList.remove("alert-"+alertType);
      alert.removeAttribute("role");
      alert.textContent = '';
    }
  }
}

