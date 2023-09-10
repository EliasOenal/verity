import { NetworkPeer } from "../model/networkPeer";
import { VerityUI } from "./VerityUI";

export class PeerDisplay {
  parent: VerityUI;

  constructor(parent: VerityUI) {
    this.parent = parent;

    // redraw peer list on NetworkManager events
    this.parent.node.networkManager.on('newpeer', (peer) => this.redisplayPeers());
    this.parent.node.networkManager.on('peerclosed', (peer) => this.redisplayPeers());
    this.parent.node.networkManager.on('updatepeer', (peer) => this.redisplayPeers());
    this.parent.node.networkManager.on('blacklist', (peer) => this.redisplayPeers());
    this.parent.node.networkManager.on('online', (peer) => this.redisplayPeers());
    this.parent.node.networkManager.on('shutdown', (peer) => this.redisplayPeers());
  }

  /**
   * Display all peers.
   * This will handle all networkManager newpeer events and redraws the peer list
   */
  redisplayPeers() {
    const peerlist: HTMLElement | null = document.getElementById("peerlist");
    if (!peerlist) return;
    peerlist.textContent = '';  // remove all children
    for (let i=0; i<this.parent.node.networkManager.outgoingPeers.length; i++) {
        peerlist.appendChild(this.drawSinglePeer(this.parent.node.networkManager.outgoingPeers[i], true));
    }
    for (let i=0; i<this.parent.node.networkManager.incomingPeers.length; i++) {
        peerlist.appendChild(this.drawSinglePeer(this.parent.node.networkManager.incomingPeers[i], false));
    }
  }

  drawSinglePeer(peer: NetworkPeer, outgoing: boolean): HTMLLIElement {
    const li = document.createElement("li");
    li.setAttribute("class", "mb-3");
    const peeraddr = document.createTextNode(`${peer.stats.ip}:${peer.stats.port}`);
    li.appendChild(peeraddr);
    li.appendChild(document.createElement("br"));
    const peerid = document.createTextNode(`ID ${peer.stats.peerID?.toString('hex')}`);
    li.appendChild(peerid);
    return li;
  }
}
