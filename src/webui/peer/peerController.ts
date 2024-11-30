import type { NetworkManagerIf } from "../../core/networking/networkManagerIf";
import type { NetworkPeerIf } from '../../core/networking/networkPeerIf';

import { NetworkPeer } from "../../core/networking/networkPeer";
import { AddressAbstraction } from '../../core/peering/addressing';
import { Peer } from "../../core/peering/peer";
import { PeerDB } from '../../core/peering/peerDB';
import { logger } from "../../core/logger";

import { OnlineView } from "./onlineView";
import { PeerView } from "./peerView"
import { ControllerContext, VerityController } from "../verityController";

export const enum ShallDisplay {
  Connected = 1,
  Exchangeable = 2,
  Verified = 3,
  Unverified = 4,
};

export class PeerController extends VerityController {
  declare public contentAreaView: PeerView;

  displayedPeers: Map<Peer, HTMLLIElement> = new Map();
  shallDisplay: ShallDisplay = ShallDisplay.Connected;
  redisplayTimeout: NodeJS.Timeout = undefined;
  onlineView: OnlineView;

  get networkManager(): NetworkManagerIf { return this.parent.node.networkManager }
  get peerDB(): PeerDB { return this.parent.node.peerDB }

  constructor(
      parent: ControllerContext,
  ){
    super(parent);
    this.contentAreaView = new PeerView(this);
    this.onlineView = new OnlineView(this);
    // subscribe to online status so we can display it in OnlineView
    this.networkManager.on('online', () => this.onlineView.showOnline());
    this.networkManager.on('offline', () => this.onlineView.showOffline());
    // show the initial online status in OnlineView
    if (this.networkManager.online) this.onlineView.showOnline();
    else this.onlineView.showOffline();
  }

  //***
  // View selection methods
  //***
  selectDetails(): Promise<void> {
    this.redisplayPeers();
    return new Promise<void>(resolve => resolve());  // nothing to do, return resolved promise
  }

  //***
  // View assembly methods
  //***
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
    let networkPeer: NetworkPeerIf = undefined;
    // TODO do not rely on instanceof, check for something on NetworkPeerIf instead (this should be fixed once we change NetworkPeer from inheriting from peer to being a companion to Peer)
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


  //***
  // Navigation methods
  //***

  /**
   * Called from: PeerView
   * Changes the peer group to be displayed
   */
  changeDisplayTo(shallDisplay: ShallDisplay): void {
    this.shallDisplay = shallDisplay;
    this.contentAreaView.markNavActive(shallDisplay);
    this.redisplayPeers();
  }

  /**
   * Called from: PeerView
   * Initiates a connection attempt to a peer
   */
  // BUGBUG: This button is currently broken for all unverified peers, i.e.
  //         peer's whose ID we dont't know
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

  /**
   * Called from: PeerView
   * Changes this peer's primary address, i.e. the address used on connection
   * attempts.
   */
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
    // TODO do not rely on instanceof, check for something on NetworkPeerIf instead (this should be fixed once we change NetworkPeer from inheriting from peer to being a companion to Peer)
    if (peer instanceof NetworkPeer) this.displayPeer(peer);  // redisplay
    else this.undisplayPeer(peer);  // apparently no longer connected
  }

  /**
   * Called from: PeerView
   * Disconnects a peer and attempts to initiate a new connection
   */
  reconnectPeer(button: HTMLButtonElement): void {
    // if already connected, disconnect first
    const peerIdString = button.getAttribute("data-peerid");  // that's why it's broken for unverified peers
    const peer: Peer = this.peerDB.getPeer(peerIdString);
    let networkPeer: NetworkPeerIf = undefined;
    // TODO do not rely on instanceof, check for something on NetworkPeerIf instead (this should be fixed once we change NetworkPeer from inheriting from peer to being a companion to Peer)
    if (peer instanceof NetworkPeer) networkPeer = peer;  // should always be true
    if (networkPeer) {
      const closePromise = networkPeer.close();
      this.redisplayPeers();
      closePromise.then(() => {
        this.networkManager.connect(peer);
        this.redisplayPeers();
      });
    } else {
      this.networkManager.connect(peer);
      this.redisplayPeers();
    }
  }

  /**
   * Called from: PeerView
   * Closes a peer connection
   */
  disconnectPeer(button: HTMLButtonElement): void {
    const peerIdString = button.getAttribute("data-peerid");
    const peer: Peer = this.peerDB.getPeer(peerIdString);
    let networkPeer: NetworkPeerIf = undefined;
    // TODO do not rely on instanceof, check for something on NetworkPeerIf instead (this should be fixed once we change NetworkPeer from inheriting from peer to being a companion to Peer)
    if (peer instanceof NetworkPeer) networkPeer = peer;  // should always be true
    if (networkPeer) {
      const closePromise = networkPeer.close();
      this.redisplayPeers();
      closePromise.then(() => this.redisplayPeers());
    }
  }

  /**
   * Called from: PeerView
   * Enables or disabled NetworkManager's peer auto-connection feature
   */
  toggleAutoConnect(sw: HTMLInputElement): void {
    if (sw.checked) {
      this.networkManager.options.autoConnect = true;
      this.networkManager.autoConnectPeers();
    } else {
      this.networkManager.options.autoConnect = false;
    }
  }

  //***
  // Cleanup methods
  //***

  shutdown(unshow: boolean = true, callback: boolean = true): Promise<void> {
    this.networkManager.removeListener('online', () => this.onlineView.showOnline());
    this.networkManager.removeListener('offline', () => this.onlineView.showOffline());

    this.close(unshow, callback);
    return super.shutdown(unshow, callback);
  }

  close(unshow: boolean = true, callback: boolean = true): Promise<void> {
    // clear redisplay polling
    if (this.redisplayTimeout !== undefined) clearInterval(this.redisplayTimeout);
    this.redisplayTimeout = undefined;
    return super.close(unshow, callback);
  }

  //***
  // Data conversion methods
  //***
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

  //***
  // Framework event handling
  //***
  async identityChanged(): Promise<boolean> {
    // this controller does not care about user Identites
    return true;
  }
}
