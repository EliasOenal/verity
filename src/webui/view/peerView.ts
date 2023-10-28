import { Peer } from "../../core/peering/peer";
import { logger } from "../../core/logger";

import { VerityView } from "../webUiDefinitions";

export class PeerView extends VerityView {
  private peerList: HTMLUListElement;

  constructor(
    private myId: string,
    private htmlTemplate: HTMLTemplateElement = document.getElementById(
        "verityPeerViewTemplate") as HTMLTemplateElement,
      show: boolean = false,
  ){
    super();
    this.renderedView =
      this.htmlTemplate.content.firstElementChild.cloneNode(true) as HTMLElement;
    this.peerList = this.renderedView.querySelector(".verityPeerList");
    this.clearAll();
    this.printMyId();
    if (show) this.show();
  }

  clearAll() {
    this.peerList.replaceChildren();
  }

  displayPeer(peer: Peer, li?: HTMLLIElement): HTMLLIElement {
    let newli: boolean = false;
    if (!li) {
      newli = true;
      li = this.newPeerEntry(peer);
    }
    // Display data, then show this peer container
    this.redrawPeerData(peer, li);
    if (newli) this.peerList.appendChild(li);
    return li;
  }

  newPeerEntry(peer: Peer): HTMLLIElement {
    const templateLi: HTMLLIElement = this.htmlTemplate.content.querySelector(".verityPeer");
    const li: HTMLLIElement = templateLi.cloneNode(true) as HTMLLIElement;
    this.peerList.appendChild(li);
    return li;
  }

  redrawPeerData(peer: Peer, peerLi: HTMLLIElement): void {
    logger.trace("PeerView: (Re-)Displaying peer "+ peer.toString());
    try {
      // Print peer ID
      const idField: HTMLTableCellElement = peerLi.querySelector('.verityPeerId');
      idField.innerText = peer.idString;
      peerLi.setAttribute("id", "verityPeer-" + peer.idString);
      // Print connected address
      const connField: HTMLTableCellElement = peerLi.querySelector('.verityPeerConn');
      connField.innerText = peer.addressString;
      // Print all known addresses
      const addrsList: HTMLTableCellElement = peerLi.querySelector('.verityPeerAddressList');
      addrsList.replaceChildren();
      for (let i=0; i<peer.addresses.length; i++) {
        const addrLi = document.createElement('li');
        addrLi.value = i;
        addrLi.appendChild(document.createTextNode(peer.addresses[i].toString() + " "));
        // Show primary address marker/button
        addrLi.appendChild(document.createElement("br"));
        const primaryButton: HTMLButtonElement = document.createElement('button');
        primaryButton.setAttribute("type", "button");
        primaryButton.setAttribute("data-peerid", peer.idString);
        primaryButton.setAttribute("data-addrindex", i.toString());
        primaryButton.setAttribute("class", "veritySmallButton btn btn-outline-primary");
        if (peer.primaryAddressIndex == i) primaryButton.classList.add("active");
        primaryButton.setAttribute("onclick", "window.verityUI.peerController.makeAddressPrimary(this)");
        primaryButton.innerText = "Primary";
        addrLi.appendChild(primaryButton);
        // All done
        addrsList.appendChild(addrLi);
      }
    } catch(err) {
      logger.error("PeerView: Could not display some peer data, did you mess with my DOM elements?! Error was: " + err);
    }
  }

  undisplayPeer(peerli: HTMLLIElement): void {
    this.peerList.removeChild(peerli);
  }

  printMyId(): void {
    const container: HTMLElement = this.renderedView.querySelector('.verityMyId');
    if (!container) logger.error("PeerView: Could not my peer ID, did you mess with my DOM elements?!");
    container.innerText = this.myId;
  }
}