import { NetworkPeer } from "../core/networkPeer";
import { VerityUI } from "./VerityUI";

export class PeerDisplay {
  parent: VerityUI;

  constructor(parent: VerityUI) {
    this.parent = parent;

    // redraw peer list on NetworkManager events
    // this.parent.node.networkManager.on('newpeer', (peer) => this.redisplayPeers());  // a peer is not actually ready and probably not even connected on the "newpeer" event, so let's ignore this
    this.parent.node.networkManager.on('peerclosed', (peer) => this.redisplayPeers());
    this.parent.node.networkManager.on('peeronline', (peer) => this.redisplayPeers());
    // this.parent.node.networkManager.on('blacklist', (peer) => this.redisplayPeers());  // we don't really have to react to this event, at least not in this very crude way
    // this.parent.node.networkManager.on('online', (peer) => this.redisplayPeers());  // we don't really have to react to this event, at least not in this very crude way
    // this.parent.node.networkManager.on('shutdown', (peer) => this.redisplayPeers());  // we don't really have to react to this event, at least not in this very crude way
  }

  /**
   * Display all peers.
   * This will handle all networkManager newpeer events and redraws the peer list
   */
  public redisplayPeers() {
    const peerlist: HTMLElement | null = document.getElementById("peerlist");
    if (!peerlist) return;
    
    // Get the current peers from NetworkManager
    const currentPeers = [
        ...this.parent.node.networkManager.outgoingPeers,
        ...this.parent.node.networkManager.incomingPeers,
    ];

    // Create a set of peer identifiers from the current peers in NetworkManager
    const currentPeerSet = new Set(currentPeers.map(peer => `${peer.ip}:${peer.port}:${peer.id}`));

    // Create a set of peer identifiers from the peers currently displayed in the HTML
    const displayedPeerSet = new Set(Array.from(peerlist.children).map(elem => elem.getAttribute('data-peer-id')));

    // Find peers to add and peers to remove
    const peersToAdd = currentPeers.filter(peer => !displayedPeerSet.has(`${peer.ip}:${peer.port}:${peer.id}`));
    const peersToRemove = Array.from(peerlist.children).filter(elem => !currentPeerSet.has(elem.getAttribute('data-peer-id')));

    // Remove peers that are no longer present
    peersToRemove.forEach(elem => peerlist.removeChild(elem));

    // Add new peers
    for (const peer of peersToAdd) {
        const isOutgoing = this.parent.node.networkManager.outgoingPeers.includes(peer);
        peerlist.appendChild(this.drawSinglePeer(peer, isOutgoing));
    }
}


  drawSinglePeer(peer: NetworkPeer, outgoing: boolean): HTMLLIElement {
    const li = document.createElement("li");
    li.setAttribute("class", "mb-3 move-fade-in");
    const peeraddr = document.createTextNode(`${peer.ip}:${peer.port}`);
    li.appendChild(peeraddr);
    li.appendChild(document.createElement("br"));
    const peerid = document.createTextNode(`ID ${peer.id?.toString('hex')}`);
    li.setAttribute('data-peer-id', `${peer.ip}:${peer.port}:${peer.id}`);
    li.appendChild(peerid);
    return li;
  }
}
