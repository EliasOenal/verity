import { logger } from "../core/logger";

/** Gets the closest parent element of a specific class */
export function getElementAboveByClassName(elem: HTMLElement, classname: string): HTMLElement {
  while (elem && !elem.classList.contains(classname)) elem = elem.parentElement;
  return elem;
}

export function setAttributeForAll(
    parent: HTMLElement,
    selector: string,
    attrName: string,
    attrValue: string | undefined,
): void {
  const selection = parent.querySelectorAll(selector);
  for (const elem of selection) {
    if (attrValue !== undefined) elem.setAttribute(attrName, attrValue);
    else elem.removeAttribute(attrName);
  }
}

function isDocumentDefined(): boolean {
  if (typeof document === 'undefined') {
    logger.error("loadTemplate(): Could not load an HTML template as the global document variable is not defined. If this happens during actual use of the app, something has seriously gone wrong. If this happened at the very beginning of a JSDOM test, it might be normal.");
    return false;
  } else return true;
}

export function loadTemplate(module: any): void {
  if (isDocumentDefined()) {
    document.body.insertAdjacentHTML('beforeend', module.default);
  }
}

export function loadStyle(module: any): void {
  if (isDocumentDefined()) {
    const styleElem: HTMLStyleElement = document.createElement("style");
    styleElem.textContent = module.default;
    document.head.appendChild(styleElem);
  }
}
