import { VerityError } from "../../core/settings";

import { NetworkManager } from "../../core/networkManager";
import { NetworkPeer } from "../../core/networkPeer";
import { logger } from "../../core/logger";

export class PeerController {
  private displayedPeers: Map<string, HTMLLIElement> = new Map();
  constructor(
      private networkManager: NetworkManager,
      private peerlist: HTMLElement = document.getElementById("peerlist")
  ){
    if (!this.peerlist) throw new VerityError("PeerDisplay: Cannot create a PeerDisplay if there is no peer list");
    const listheader: HTMLElement = document.getElementById('verityPeerListHeader') as HTMLElement;
    if (listheader) listheader.setAttribute("title", `My ID is ${this.networkManager.peerID.toString('hex')}`);
    this.networkManager.on('peeronline', (peer) => this.redisplayPeers());
    this.networkManager.on('updatepeer', (peer) => this.redisplayPeers());
    this.networkManager.on('peerclosed', (peer) => this.redisplayPeers());
  }

  public redisplayPeers(): void {
    const peersUnaccountedFor: Map<string, HTMLLIElement> = new Map(this.displayedPeers);
    for (const peer of this.networkManager.incomingPeers.concat(
                       this.networkManager.outgoingPeers)
    ){
      peersUnaccountedFor.delete(peer.idString);
      this.displayPeer(peer);
    }
    for (const idString of peersUnaccountedFor.keys()) {
      this.undisplayPeer(idString);
    }
  }

  public displayPeer(peer: NetworkPeer): void {
    if (!peer.id) return;  // this should never have been called for non-verified peers
    // Peer already displayed?
    let li: HTMLLIElement = this.displayedPeers.get(peer.idString);
    let newli: boolean = false;
    if (!li) {
      // logger.trace("PeerDisplay: Creating new li for peer " + peer.toString());
      newli = true;
      // Create container and set attributes
      li = document.createElement("li");
      li.setAttribute("class", "verityPeer mb-3 move-fade-in");
      const addrLine: HTMLParagraphElement = document.createElement('p');
      addrLine.setAttribute("class", "verityPeerLine verityPeerAddressLine");
      li.appendChild(addrLine);
      const idLine: HTMLParagraphElement = document.createElement('p');
      idLine.setAttribute("class", "verityPeerLine verityPeerIdLine");
      li.appendChild(idLine);
      this.displayedPeers.set(peer.idString, li);
    }
    // Display data, then show this peer container
    this.redrawPeerData(peer, li);
    if (newli) this.peerlist.appendChild(li);
  }

  redrawPeerData(peer: NetworkPeer, li: HTMLLIElement) {
    if (!peer.id) return;  // this should never have been called for non-verified peers
    // logger.trace("PeerDisplay: (Re-)Displaying peer "+ peer.toString());
    try {
      // Print peer address
      const addrLine: HTMLParagraphElement =
        li.getElementsByClassName("verityPeerAddressLine")[0] as HTMLParagraphElement;
      addrLine.innerText = peer.addressString;
      addrLine.setAttribute("title", peer.allAddressesString);
      // Print peer ID
      const idLine: HTMLParagraphElement =
        li.getElementsByClassName("verityPeerIdLine")[0] as HTMLParagraphElement;
      idLine.innerText = "ID " + peer.idString;
      li.setAttribute("id", "verityPeer-" + peer.idString);
      // Show tooltip
      li.setAttribute("title", peer.toString());
    } catch(err) {
      logger.error("PeerDisplay: Could not display some peer data, did you mess with my DOM elements?! Error was: " + err);
    }
  }

  public undisplayPeer(idString: string): void {
    // logger.trace("PeerDisplay: Undisplaying peer " + idString);
    const peerli = this.displayedPeers.get(idString);
    this.peerlist.removeChild(peerli);
    this.displayedPeers.delete(idString);
  }
}
