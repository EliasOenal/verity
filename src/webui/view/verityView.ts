import { UiError } from "../webUiDefinitions";
import { logger } from "../../core/logger";

// TODO: make template handling more clearly optional

export const alertTypes =
  ['primary', 'secondary', 'success', 'danger', 'warning', 'info', 'light', 'dark'] as const;
export type AlertTypeList = typeof alertTypes[number];

/** Abstract base class for our views */
export abstract class VerityView {
  renderedView: HTMLElement;

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
    try {
      this.viewArea.removeChild(this.renderedView);
    } catch (err) {
      logger.debug("VerityView.unshow: Error unshowing: " + err?.toString() ?? err);
    }
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

  makeAlert(
      container: HTMLElement | string,
      type: AlertTypeList,
      msg: string,
      exclusive: boolean = false,
  ): HTMLElement {
    if (exclusive) this.clearAlerts();
    if (typeof container === 'string') {
      container = this.renderedView.querySelector(container) as HTMLElement;
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

  formatDate(
      unixtime: number,
      dateFormat: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }
  ): string {
    const date: Date = new Date(unixtime*1000);
    const dateText =
      date.toLocaleDateString(navigator.language, dateFormat) + " " +
      date.toLocaleTimeString(navigator.language);
    return dateText;
  }
}

