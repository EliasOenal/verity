import { Peer } from "../../core/peering/peer";
import { NetworkPeer, NetworkPeerLifecycle } from "../../core/networking/networkPeer";
import { logger } from "../../core/logger";
import { VerityView } from "./verityView";
import { unixtime } from "../../core/helpers";
import { ShallDisplay } from "../controller/peerController";

export class PeerView extends VerityView {
  private peerList: HTMLUListElement;

  constructor(
      private myId: string,
      htmlTemplate: HTMLTemplateElement = document.getElementById(
        "verityPeerViewTemplate") as HTMLTemplateElement,
      show: boolean = false,
  ){
    super(htmlTemplate);
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
      li = this.newFromTemplate(".verityPeer") as HTMLLIElement;
    }
    // Display data, then show this peer container
    this.redrawPeerData(peer, li);
    if (newli) this.peerList.appendChild(li);
    return li;
  }

  redrawPeerData(peer: Peer, peerLi: HTMLLIElement): void {
    // TODO change once we refactor NetworkPeer into encapsulating Peer rather
    // than inheriting from it
    let networkPeer: NetworkPeer = undefined;
    if (peer instanceof NetworkPeer) networkPeer = peer;

    // logger.trace("PeerView: (Re-)Displaying peer "+ peer.toString());
    try {
      // Print & set peer ID on all relevant elements
      const idField: HTMLTableCellElement = peerLi.querySelector('.verityPeerId');
      idField.innerText = peer.idString ?? "unknown";
      peerLi.setAttribute("id", "verityPeer-" + peer.idString);
      // Print connected address
      const connField: HTMLTableCellElement = peerLi.querySelector('.verityPeerConn');
      if (networkPeer) {
        connField.innerText = networkPeer.conn.addressString;
      } else {
        connField.innerText = "Not connected"
      }
      // Print connection status
      const statusField: HTMLTableCellElement =
        peerLi.querySelector('.verityPeerTransmissionStatus');
      if (networkPeer) {
        if (networkPeer.status === NetworkPeerLifecycle.CONNECTING) {
          statusField.innerText = "Trying to connect...";
        } else if (networkPeer.status === NetworkPeerLifecycle.HANDSHAKING) {
          statusField.innerText = "Handshaking...";
        } else if (networkPeer.status === NetworkPeerLifecycle.ONLINE) {
          if (networkPeer.conn.errorCount === 0) {
            statusField.innerText = "OK";
          } else {
            statusField.innerText = `${networkPeer.conn.errorCount} errors over ${
                unixtime() - networkPeer.conn.lastSuccessfulTransmission
              } seconds`;
          }
        } else if (networkPeer.status === NetworkPeerLifecycle.CLOSING) {
          statusField.innerText = "Closing connection...";
        } else if (networkPeer.status === NetworkPeerLifecycle.CLOSED) {
          statusField.innerText = 'Not connected';
        } else {  // should never happen
          statusField.innerText = 'Unknown NetworkPeer lifecycle status: ' + networkPeer.status;
        }
      } else {
        statusField.innerText = 'Not connected';
      }
      // Print all known addresses
      const addrsList: HTMLTableCellElement =
        peerLi.querySelector('.verityPeerAddressList');
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
      // Only Display appropriate connect/reconnect/disconnect buttons
      const buttonContainer: HTMLElement = peerLi.querySelector('.verityPeerConnectionControls');
      // All buttons are predefined in the template, so let's first fetch them.
      const connectButton = this.newFromTemplate('.verityPeerConnectButton');
      connectButton.setAttribute("data-peerid", peer.idString);
      const reconnectButton = this.newFromTemplate('.verityPeerReconnectButton');
      reconnectButton.setAttribute("data-peerid", peer.idString);
      const disconnectButton = this.newFromTemplate('.verityPeerDisconnectButton');
      disconnectButton.setAttribute("data-peerid", peer.idString);
      // Now based on connection status, only show the correct buttons
      if (!networkPeer || networkPeer.status >= NetworkPeerLifecycle.CLOSING) {
        buttonContainer.replaceChildren(connectButton);
      } else {
        buttonContainer.replaceChildren(reconnectButton, disconnectButton);
      }
    } catch(err) {
      logger.error("PeerView: Could not display some peer data, did you mess with my DOM elements?! Error was: " + err?.toString() ?? err);
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

  markNavActive(shallDisplay: ShallDisplay): void {
    for (const item of this.renderedView.querySelectorAll('.verityPeerTypeNavLink')) {
      const sda: ShallDisplay = parseInt(
        item.getAttribute("data-verityShallDisplay"));
      if (sda === shallDisplay) item.classList.add("active");
      else item.classList.remove("active");
    }
  }
}