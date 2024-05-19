import { VerityView } from "./verityView";

export class OnlineView extends VerityView {
  constructor(
      readonly controllerId: number,
      viewArea: HTMLElement = document.getElementById("verityOnlineStatusArea"),
      show: boolean = false,
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
    this.renderedView = document.createElement('a');
    this.renderedView.setAttribute("class", "verityOnlineStatus");
    this.renderedView.setAttribute("href", "#");
    this.renderedView.setAttribute("onclick",
      `window.verity.nav.show(${this.controllerId}, "details")`);
    const greenDot: HTMLElement = document.createElement('span');
    greenDot.setAttribute("class", dot);
    this.renderedView.appendChild(greenDot);
    this.renderedView.appendChild(document.createTextNode(text));
  }
}