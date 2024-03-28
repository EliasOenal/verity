export function getElementAboveByClassName(elem: HTMLElement, classname: string): HTMLElement {
  while (elem && !elem.classList.contains(classname)) elem = elem.parentElement;
  return elem;
}