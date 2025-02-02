import type { NetworkPeerIf } from '../../core/networking/networkPeerIf';
import type { PeerController, ShallDisplay } from "./peerController";

import { NetworkPeerLifecycle } from '../../core/networking/networkPeerIf';
import { Peer } from "../../core/peering/peer";
import { NetworkPeer } from "../../core/networking/networkPeer";
import { VerityView } from "../verityView";
import { unixtime } from "../../core/helpers/misc";
import { humanFileSize } from "../helpers/datetime";

import { logger } from "../../core/logger";

export class PeerView extends VerityView {
  private peerList: HTMLUListElement;

  constructor(
      controller: PeerController,
      htmlTemplate: HTMLTemplateElement = document.getElementById(
        "verityPeerViewTemplate") as HTMLTemplateElement,
      show: boolean = false,
  ){
    super(controller, htmlTemplate);
    this.peerList = this.renderedView.querySelector(".verityPeerList");
    this.clearAll();
    this.printMyId();
    if (show) this.show();
  }

  get myId(): string { return this.controller.parent.node.networkManager.id.toString('hex'); }

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
    const freshLi = this.newFromTemplate(".verityPeer") as HTMLLIElement;
    // TODO change once we refactor NetworkPeer into encapsulating Peer rather
    // than inheriting from it
    let networkPeer: NetworkPeerIf = undefined;
    // TODO do not rely on instanceof, check for something on NetworkPeerIf instead (this should be fixed once we change NetworkPeer from inheriting from peer to being a companion to Peer)
    if (peer instanceof NetworkPeer) networkPeer = peer;

    // logger.trace("PeerView: (Re-)Displaying peer "+ peer.toString());
    try {
      // Print & set peer ID on all relevant elements
      const idField: HTMLTableCellElement = freshLi.querySelector('.verityPeerId');
      idField.textContent = peer.idString ?? "unknown";
      freshLi.setAttribute("id", "verityPeer-" + peer.idString);

      // Print trust score
      const trustField: HTMLTableCellElement = freshLi.querySelector('.verityPeerScore');
      trustField.textContent = peer.trustScore.toString();

      // Print peer connection information depending on whether this peer is
      // connected or not (i.e. whether or not it is a NetworkPeer)
      if (networkPeer) {  // connected peer
        // Print connection status
        const statusField: HTMLTableCellElement =
          freshLi.querySelector('.verityPeerStatus');
        if (networkPeer.status === NetworkPeerLifecycle.CONNECTING) {
          statusField.textContent = "Trying to connect...";
        } else if (networkPeer.status === NetworkPeerLifecycle.HANDSHAKING) {
          statusField.textContent = "Handshaking...";
        } else if (networkPeer.status === NetworkPeerLifecycle.ONLINE) {
          if (networkPeer.conn.errorCount === 0) {
            statusField.textContent = "OK";
          } else {
            statusField.textContent = `${networkPeer.conn.errorCount} errors over ${
                unixtime() - networkPeer.conn.lastSuccessfulTransmission
              } seconds`;
          }
        } else if (networkPeer.status === NetworkPeerLifecycle.CLOSING) {
          statusField.textContent = "Closing connection...";
        } else if (networkPeer.status === NetworkPeerLifecycle.CLOSED) {
          statusField.textContent = 'Not connected';
        } else {  // should never happen
          statusField.textContent = 'Unknown NetworkPeer lifecycle status: ' + networkPeer.status;
        }

        // Print connected address
        const connField: HTMLTableCellElement = freshLi.querySelector('.verityPeerConn');
        connField.textContent = networkPeer.conn.addressString;

        // Print transmission stats
        const txMsg: HTMLTableCellElement = freshLi.querySelector('.verityPeerTxMsg');
        txMsg.textContent = networkPeer.stats.tx.messages.toString();
        const txBytes: HTMLTableCellElement = freshLi.querySelector('.verityPeerTxSize');
        txBytes.textContent = humanFileSize(networkPeer.stats.tx.bytes);
        const rxMsg: HTMLTableCellElement = freshLi.querySelector('.verityPeerRxMsg');
        rxMsg.textContent = networkPeer.stats.rx.messages.toString();
        const rxBytes: HTMLTableCellElement = freshLi.querySelector('.verityPeerRxSize');
        rxBytes.textContent = humanFileSize(networkPeer.stats.rx.bytes);

      } else {  // disconnected peer
        // Print connection status
        const statusField: HTMLTableCellElement =
          freshLi.querySelector('.verityPeerStatus');
        statusField.textContent = 'Not connected';

        // Remove connected address
        const connRow: HTMLTableRowElement = freshLi.querySelector('.verityPeerConnRow');
        connRow.remove();

        // Remove transmission stats
        const transmissionRow: HTMLTableRowElement = freshLi.querySelector('.verityPeerTransmissionRow');
        transmissionRow.remove();
      }

      // Print all known addresses
      const addrsList: HTMLTableCellElement =
        freshLi.querySelector('.verityPeerAddressList');
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
        primaryButton.setAttribute("onclick", "window.verity.peerController.makeAddressPrimary(this)");
        primaryButton.textContent = "Primary";
        addrLi.appendChild(primaryButton);
        // All done
        addrsList.appendChild(addrLi);
      }

      // Only Display appropriate connect/reconnect/disconnect buttons
      const buttonContainer: HTMLElement = freshLi.querySelector('.verityPeerConnectionControls');
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

      // All done, replace the old peerLi with the new one
      peerLi.replaceChildren(...freshLi.children);
    } catch(err) {
      logger.error("PeerView: Could not display some peer data, did you mess with my DOM elements?! Error was: " + err?.toString());
    }
  }

  undisplayPeer(peerli: HTMLLIElement): void {
    this.peerList.removeChild(peerli);
  }

  printMyId(): void {
    const container: HTMLElement = this.renderedView.querySelector('.verityMyId');
    if (!container) logger.error("PeerView: Could not my peer ID, did you mess with my DOM elements?!");
    container.textContent = this.myId;
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