export function toggleCollapsible(control: HTMLElement, collapsible: HTMLElement): void {
  if (control.classList.contains("collapsed")) {
    control.classList.remove("collapsed");
    control.ariaExpanded = "true";
    collapsible.classList.add("show");
  } else {
    control.classList.add("collapsed");
    control.ariaExpanded = "false";
    collapsible.classList.remove("show");
  }
}
