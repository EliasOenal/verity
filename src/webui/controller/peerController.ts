import { Settings, VerityError } from '../../core/settings';
import { NetworkManager } from "../../core/networking/networkManager";
import { NetworkPeer } from "../../core/networking/networkPeer";
import { AddressAbstraction } from '../../core/peering/addressing';
import { Peer } from "../../core/peering/peer";
import { logger } from "../../core/logger";

import { VerityController } from "../webUiDefinitions";
import { OnlineView } from "../view/onlineView";
import { PeerView } from "../view/peerView"

export class PeerController extends VerityController {
  declare view: PeerView;
  displayedPeers: Map<string, HTMLLIElement> = new Map();

  constructor(
      private networkManager: NetworkManager,
      view = new PeerView(networkManager.peerID.toString('hex')),
      private onlineView = new OnlineView(),
  ){
    super(view);
    this.networkManager.on('peeronline', (peer) => this.redisplayPeers());
    this.networkManager.on('updatepeer', (peer) => this.redisplayPeers());
    this.networkManager.on('peerclosed', (peer) => this.redisplayPeers());
    this.redisplayPeers();

    this.networkManager.on('online', () => this.onlineView.showOnline());
    this.networkManager.on('offline', () => this.onlineView.showOffline());
    if (this.networkManager.online) this.onlineView.showOnline();
    else this.onlineView.showOffline();
  }

  redisplayPeers(): void {
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

  displayPeer(peer: NetworkPeer): void {
    if (!peer.id) return;  // this should never have been called for non-verified peers
    // Peer already displayed?
    let li: HTMLLIElement = this.displayedPeers.get(peer.idString);
    li = this.view.displayPeer(peer, li);
    this.displayedPeers.set(peer.idString, li);
  }

  undisplayPeer(idString: string): void {
    // logger.trace("PeerDisplay: Undisplaying peer " + idString);
    const peerli = this.displayedPeers.get(idString);
    this.view.undisplayPeer(peerli);
    this.displayedPeers.delete(idString);
  }

  connectPeer(form: HTMLFormElement) {
    const input: HTMLInputElement = form.querySelector('.verityNewPeerInput');
    const addr: AddressAbstraction = AddressAbstraction.CreateAddress(input.value);
    if (addr) {
      input.classList.remove("bg-danger");
      input.value = '';
      const peer = new Peer(addr);
      this.networkManager.connect(peer);
    } else {
      input.classList.add("bg-danger");
      return;
    }
  }
}
