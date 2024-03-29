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
  displayedPeers: Map<Peer, HTMLLIElement> = new Map();
  shallDisplay: ShallDisplay = ShallDisplay.Connected;
  redisplayTimeout: NodeJS.Timeout = undefined;

  constructor(
      private networkManager: NetworkManager,
      private peerDB: PeerDB,
      public contentAreaView = new PeerView(networkManager.id.toString('hex')),
      private onlineView = new OnlineView(),
  ){
    super();
    // maybo TODO: PeerController should do all this stuff only when asked to.
    // The constructor is not meant to fire up optional features -- and the
    // peer detail view is not just optional but probably rarely used.
    // Note: Subscriptions disabled as we're currently just polling once per second
    // this.networkManager.on('peeronline', (peer) => this.redisplayPeers());
    // this.networkManager.on('updatepeer', (peer) => this.redisplayPeers());
    // this.networkManager.on('peerclosed', (peer) => this.redisplayPeers());
    // this.peerDB.on('newPeer', (peer) => this.redisplayPeers());
    // this.peerDB.on('verifiedPeer', (peer) => this.redisplayPeers());
    // this.peerDB.on('exchangeablePeer', (peer) => this.redisplayPeers());
    // this.peerDB.on('removePeer', (peer) => this.redisplayPeers());
    this.redisplayPeers();

    this.networkManager.on('online', () => this.onlineView.showOnline());
    this.networkManager.on('offline', () => this.onlineView.showOffline());
    if (this.networkManager.online) this.onlineView.showOnline();
    else this.onlineView.showOffline();
  }

  changeDisplayTo(shallDisplay: ShallDisplay): void {
    this.shallDisplay = shallDisplay;
    this.contentAreaView.markNavActive(shallDisplay);
    this.redisplayPeers();
  }

  redisplayPeers(): void {
    if (this.redisplayTimeout !== undefined) clearInterval(this.redisplayTimeout);
    this.redisplayTimeout = undefined;
    const peersUnaccountedFor: Map<Peer, HTMLLIElement> = new Map(this.displayedPeers);
    for (const peer of this.shallDisplayPeers()) {
      peersUnaccountedFor.delete(peer);
      this.displayPeer(peer);
    }
    for (const peer of peersUnaccountedFor.keys()) {
      this.undisplayPeer(peer);
    }
    // all done, redisplay in one second
    this.redisplayTimeout = setTimeout(() => this.redisplayPeers(), 1000);
  }

  displayPeer(peer: Peer): void {
    // TODO change once we refactor NetworkPeer into encapsulating Peer rather
    // than inheriting from it
    let networkPeer: NetworkPeer = undefined;
    if (peer instanceof NetworkPeer) networkPeer = peer;

    // Peer already displayed?
    let li: HTMLLIElement = this.displayedPeers.get(peer);
    li = this.contentAreaView.displayPeer(peer, li);
    this.displayedPeers.set(peer, li);
  }

  undisplayPeer(peer: Peer): void {
    // logger.trace("PeerDisplay: Undisplaying peer " + peer.idString);
    const peerli = this.displayedPeers.get(peer);
    this.contentAreaView.undisplayPeer(peerli);
    this.displayedPeers.delete(peer);
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
    else this.undisplayPeer(peer);  // apparently no longer connected
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
    // Note: Subscriptions disabled as we're currently just polling once per second
    // this.networkManager.removeListener('peeronline', (peer) => this.redisplayPeers());
    // this.networkManager.removeListener('updatepeer', (peer) => this.redisplayPeers());
    // this.networkManager.removeListener('peerclosed', (peer) => this.redisplayPeers());
    // this.peerDB.removeListener('newPeer', (peer) => this.redisplayPeers());
    // this.peerDB.removeListener('verifiedPeer', (peer) => this.redisplayPeers());
    // this.peerDB.removeListener('exchangeablePeer', (peer) => this.redisplayPeers());
    // this.peerDB.removeListener('removePeer', (peer) => this.redisplayPeers());
    this.networkManager.removeListener('online', () => this.onlineView.showOnline());
    this.networkManager.removeListener('offline', () => this.onlineView.showOffline());

    this.close();
    return super.shutdown();
  }

  close(): Promise<void> {
    // clear redisplay polling
    if (this.redisplayTimeout !== undefined) clearInterval(this.redisplayTimeout);
    this.redisplayTimeout = undefined;
    return super.close();
  }

  private *shallDisplayPeers(): Generator<Peer> {
    if (this.shallDisplay === ShallDisplay.Connected) {
      for (const peer of this.networkManager.incomingPeers.concat(
             this.networkManager.outgoingPeers)) yield peer;
    } else if (this.shallDisplay === ShallDisplay.Exchangeable) {
      for (const peer of this.peerDB.peersExchangeable.values()) yield peer;
    } else if (this.shallDisplay === ShallDisplay.Verified) {
      for (const peer of this.peerDB.peersVerified.values()) yield peer;
    } else if (this.shallDisplay === ShallDisplay.Unverified) {
      for (const peer of this.peerDB.peersUnverified.values()) yield peer;
    } else {
      return;
    }
  }
}
