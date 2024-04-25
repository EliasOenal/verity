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