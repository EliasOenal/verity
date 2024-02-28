import { NetworkPeer } from "../../core/networking/networkPeer";
import { NetworkManager } from "../../core/networking/networkManager";
import { AddressAbstraction } from '../../core/peering/addressing';
import { Peer } from "../../core/peering/peer";
import { PeerDB } from '../../core/peering/peerDB';
import { logger } from "../../core/logger";

import { OnlineView } from "../view/onlineView";
import { PeerView } from "../view/peerView"
import { VerityController } from "./verityController";

export const enum ShallDisplay {
  Connected = 1,
  Exchangeable = 2,
  Verified = 3,
  Unverified = 4,
};

export class PeerController extends VerityController {
  displayedPeers: Map<string, HTMLLIElement> = new Map();
  shallDisplay: ShallDisplay = ShallDisplay.Connected;

  constructor(
      private networkManager: NetworkManager,
      private peerDB: PeerDB,
      public peerView = new PeerView(networkManager.id.toString('hex')),
      private onlineView = new OnlineView(),
  ){
    super();
    // maybo TODO: PeerController should do all this stuff only when asked to.
    // The constructor is not meant to fire up optional features -- and the
    // peer detail view is not just optional but probably rarely used.
    this.networkManager.on('peeronline', (peer) => this.redisplayPeers());
    this.networkManager.on('updatepeer', (peer) => this.redisplayPeers());
    this.networkManager.on('peerclosed', (peer) => this.redisplayPeers());
    this.peerDB.on('newPeer', (peer) => this.redisplayPeers());
    this.peerDB.on('verifiedPeer', (peer) => this.redisplayPeers());
    this.peerDB.on('exchangeablePeer', (peer) => this.redisplayPeers());
    this.peerDB.on('removePeer', (peer) => this.redisplayPeers());
    this.redisplayPeers();

    this.networkManager.on('online', () => this.onlineView.showOnline());
    this.networkManager.on('offline', () => this.onlineView.showOffline());
    if (this.networkManager.online) this.onlineView.showOnline();
    else this.onlineView.showOffline();
  }

  changeDisplayTo(shallDisplay: ShallDisplay): void {
    this.shallDisplay = shallDisplay;
    this.peerView.markNavActive(shallDisplay);
    this.redisplayPeers();
  }

  redisplayPeers(): void {
    const peersUnaccountedFor: Map<string, HTMLLIElement> = new Map(this.displayedPeers);
    for (const peer of this.shallDisplayPeers()) {
      peersUnaccountedFor.delete(peer.idString);
      this.displayPeer(peer);
    }
    for (const idString of peersUnaccountedFor.keys()) {
      this.undisplayPeer(idString);
    }
  }

  displayPeer(peer: Peer): void {
    // TODO change once we refactor NetworkPeer into encapsulating Peer rather
    // than inheriting from it
    let networkPeer: NetworkPeer = undefined;
    if (peer instanceof NetworkPeer) networkPeer = peer;

    if (!peer.id) return;  // this should never have been called for non-verified peers
    // Peer already displayed?
    let li: HTMLLIElement = this.displayedPeers.get(peer.idString);
    li = this.peerView.displayPeer(peer, li);
    this.displayedPeers.set(peer.idString, li);
    if (networkPeer) {
      networkPeer.conn.once("transmissionLogged", () => this.displayPeer(peer));
    }
  }

  undisplayPeer(idString: string): void {
    // logger.trace("PeerDisplay: Undisplaying peer " + idString);
    const peerli = this.displayedPeers.get(idString);
    this.peerView.undisplayPeer(peerli);
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
      logger.warn(`PeerController.makeAddressPrimary(): Tried to set primary address for peer ${peerIdString}, but I can't find them.`);
      return;
    }
    const index: number = parseInt(button.getAttribute("data-addrindex"));
    if (isNaN(index)) {
      logger.error(`PeerController.makeAddressPrimary(): Tried to set primary address for peer ${peerIdString}, but did not receive a valid address index.`)
      return;
    }
    peer.primaryAddressIndex = index;
    if (peer instanceof NetworkPeer) this.displayPeer(peer);  // redisplay
    else this.undisplayPeer(peer.idString);  // apparently no longer connected
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

  shutdown(): Promise<void> {
    this.networkManager.removeListener('peeronline', (peer) => this.redisplayPeers());
    this.networkManager.removeListener('updatepeer', (peer) => this.redisplayPeers());
    this.networkManager.removeListener('peerclosed', (peer) => this.redisplayPeers());
    this.peerDB.removeListener('newPeer', (peer) => this.redisplayPeers());
    this.peerDB.removeListener('verifiedPeer', (peer) => this.redisplayPeers());
    this.peerDB.removeListener('exchangeablePeer', (peer) => this.redisplayPeers());
    this.peerDB.removeListener('removePeer', (peer) => this.redisplayPeers());
    this.networkManager.removeListener('online', () => this.onlineView.showOnline());
    this.networkManager.removeListener('offline', () => this.onlineView.showOffline());
    // Return a resolved promise
    return new Promise<void>(resolve => resolve());
  }

  private shallDisplayPeers(): Peer[] {
    if (this.shallDisplay === ShallDisplay.Connected) {
      return this.networkManager.incomingPeers.concat(
        this.networkManager.outgoingPeers);
    } else if (this.shallDisplay === ShallDisplay.Exchangeable) {
      return Array.from(this.peerDB.peersExchangeable.values());
    } else if (this.shallDisplay === ShallDisplay.Verified) {
      return Array.from(this.peerDB.peersVerified.values());
    } else if (this.shallDisplay === ShallDisplay.Unverified) {
      return Array.from(this.peerDB.peersUnverified.values());
    } else {
      return [];
    }
  }
}
