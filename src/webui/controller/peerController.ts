import { VerityError } from "../../core/settings";

import { PeerView } from "../view/peerView"
import { NetworkManager } from "../../core/networkManager";
import { NetworkPeer } from "../../core/networkPeer";
import { logger } from "../../core/logger";

import { VerityController } from "../webUiDefinitions";

export class PeerController extends VerityController {
  declare view: PeerView;
  displayedPeers: Map<string, HTMLLIElement> = new Map();

  constructor(
      private networkManager: NetworkManager,
      view = new PeerView()
  ){
    super(view);
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
    if (!li) {
      li = this.view.newPeerEntry(peer);
      this.displayedPeers.set(peer.idString, li);
    }
    // Display data, then show this peer container
    this.view.redrawPeerData(peer, li);
  }

  public undisplayPeer(idString: string): void {
    // logger.trace("PeerDisplay: Undisplaying peer " + idString);
    const peerli = this.displayedPeers.get(idString);
    this.view.undisplayPeer(peerli);
    this.displayedPeers.delete(idString);
  }
}
