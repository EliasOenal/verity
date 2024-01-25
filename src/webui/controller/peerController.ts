import { NetworkPeer } from "../../core/networking/networkPeer";
import { NetworkManager } from "../../core/networking/networkManager";
import { AddressAbstraction } from '../../core/peering/addressing';
import { Peer } from "../../core/peering/peer";
import { PeerDB } from '../../core/peering/peerDB';
import { logger } from "../../core/logger";

import { VerityController } from "../webUiDefinitions";
import { OnlineView } from "../view/onlineView";
import { PeerView } from "../view/peerView"

export class PeerController extends VerityController {
  declare view: PeerView;
  displayedPeers: Map<string, HTMLLIElement> = new Map();

  constructor(
      private networkManager: NetworkManager,
      private peerDB: PeerDB,
      view = new PeerView(networkManager.id.toString('hex')),
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

  displayPeer(peer: Peer): void {
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

  makeAddressPrimary(button: HTMLButtonElement) {
    const peerIdString = button.getAttribute("data-peerid");
    const peer: Peer = this.peerDB.getPeer(peerIdString);
    if (!peer) {
      logger.error(`PeerController.makeAddressPrimary(): Tried to set primary address for peer ${peerIdString}, but I can't find them.`);
      return;
    }
    const index: number = parseInt(button.getAttribute("data-addrindex"));
    if (isNaN(index)) {
      logger.error(`PeerController.makeAddressPrimary(): Tried to set primary address for peer ${peerIdString}, but did not receive a valid address index.`)
      return;
    }
    peer.primaryAddressIndex = index;
    this.displayPeer(peer);  // redisplay
  }

  disconnectPeer(button: HTMLButtonElement, reconnect: boolean = false): void {
    const peerIdString = button.getAttribute("data-peerid");
    const peer: NetworkPeer = this.peerDB.getPeer(peerIdString) as NetworkPeer;
    try {  // peers currently connected are guaranteed to be NetworkPeers, but just in case...
      peer.close();
      if (reconnect) this.networkManager.connect(peer);
    } catch(error) {
      logger.error(`PeerController.disconnectPeer(): Error disconnecting peer ${peerIdString}: ${error}`);
    }
  }

  toggleAutoConnect(sw: HTMLInputElement): void {
    if (sw.checked) {
      this.networkManager.autoConnect = true;
      this.networkManager.autoConnectPeers();
    } else {
      this.networkManager.autoConnect = false;
    }
  }
}
