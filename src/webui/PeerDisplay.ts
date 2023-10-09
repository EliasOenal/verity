import { VerityError } from "../core/config";
import { NetworkPeer } from "../core/networkPeer";
import { VerityUI } from "./VerityUI";

export class PeerDisplay {
  constructor(
      private parent: VerityUI,
      private peerlist: HTMLElement = document.getElementById("peerlist")
  ){
    if (!this.peerlist) throw new VerityError("PeerDisplay: Cannot create a PeerDisplay if there is no peer list");
    const listheader: HTMLElement = document.getElementById('verityPeerListHeader') as HTMLElement;
    if (listheader) listheader.setAttribute("title", `My ID is ${this.parent.node.networkManager.peerID.toString('hex')}`);
    this.parent.node.networkManager.on('peeronline', (peer) => this.displayPeer(peer));
    this.parent.node.networkManager.on('peerclosed', (peer) => this.undisplayPeer(peer));
  }

  public redisplayPeers(): void {
    this.peerlist.innerText = '';
    for (const peer of this.parent.node.networkManager.incomingPeers.concat(
                       this.parent.node.networkManager.outgoingPeers)
    ){
      this.displayPeer(peer);
    }
  }

  public displayPeer(peer: NetworkPeer): void {
    if (!peer.id) return;  // this should never have been called for non-verified peers
    // Create container and set attributes
    const li = document.createElement("li");
    li.setAttribute("title", peer.toString());
    li.setAttribute("class", "verityPeer mb-3 move-fade-in");
    // Print peer address
    const peeraddr = document.createTextNode(peer.address.toString());
    li.appendChild(peeraddr);
    // Print peer ID
    li.appendChild(document.createElement("br"));
    const peerid = document.createTextNode(`ID ${peer.id?.toString('hex')}`);
    li.setAttribute('data-peer-id', peer.id.toString('hex'));
    li.appendChild(peerid);
    this.peerlist.appendChild(li);
  }

  public undisplayPeer(peer: NetworkPeer): void {
    if (!peer.id) return;  // this should never have been called for non-verified peers
    for (const peerli of this.peerlist.getElementsByClassName("verityPeer")) {
      const displayedPeerId: string = peerli.getAttribute('data-peer-id');
      if (peer.id.toString('hex') == displayedPeerId) {
        this.peerlist.removeChild(peerli);
      }
    }
  }
}
