import { UiError } from "./webUiDefinitions";
import { logger } from "../core/logger";
import type { VerityController } from "./verityController";

// TODO: make template handling more clearly optional

export const alertTypes =
  ['primary', 'secondary', 'success', 'danger', 'warning', 'info', 'light', 'dark'] as const;
export type AlertTypeList = typeof alertTypes[number];

/** Abstract base class for our views */
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
    container.innerText = msg;
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
      alert.innerText = '';
    }
  }
}

