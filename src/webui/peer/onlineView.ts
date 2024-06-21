import { VerityView } from "../verityView";
import type { PeerController } from "./peerController";

export class OnlineView extends VerityView {
  declare readonly controller: PeerController;

  constructor(
      controller: PeerController,
      viewArea: HTMLElement = document.getElementById("verityOnlineStatusArea"),
      public renderedView = document.createElement('a'),
      show: boolean = false,
  ){
    super(controller, undefined, viewArea);
    if (show) this.show();
  }

  showOnline(): void {
    this.showStatus("Online", "greenDot");
  }

  showOffline(): void {
    this.showStatus("Offline", "redDot");
  }

  private showStatus(text: string, dot: string) {
    this.renderedView.setAttribute("class", "verityOnlineStatus");
    this.renderedView.setAttribute("href", "#");
    this.renderedView.onclick = () =>
      this.controller.parent.nav.show({
        controller: this.controller,
        navAction: this.controller.selectDetails,
      });
    const greenDot: HTMLElement = document.createElement('span');
    greenDot.setAttribute("class", dot);
    this.renderedView.replaceChildren(greenDot);
    this.renderedView.appendChild(document.createTextNode(text));
  }
}