import { VerityView } from "./verityView";

export class OnlineView extends VerityView {
  constructor(
      readonly controllerId: number,
      viewArea: HTMLElement = document.getElementById("verityOnlineStatusArea"),
      show: boolean = true,
  ){
    super(undefined, viewArea);
    if (show) this.show();
  }

  showOnline(): void {
    this.showStatus("Online", "greenDot");
  }

  showOffline(): void {
    this.showStatus("Offline", "redDot");
  }

  private showStatus(text: string, dot: string) {
    const renderedView: HTMLElement = document.createElement('a');
    renderedView.setAttribute("class", "verityOnlineStatus");
    renderedView.setAttribute("href", "#");
    renderedView.setAttribute("onclick",
      `window.verity.nav.show(${this.controllerId}, "details")`);
    const greenDot: HTMLElement = document.createElement('span');
    greenDot.setAttribute("class", dot);
    renderedView.appendChild(greenDot);
    renderedView.appendChild(document.createTextNode(text));
    this.viewArea.replaceChildren(renderedView);
  }
}