import { Cockpit } from "../cci/cockpit";
import { IdentityOptions } from "../cci/identity/identity.definitions";
import { VerityNodeIf, VerityNodeOptions, dummyVerityNode } from "../cci/verityNode";
import { IdentityController, IdentityControllerOptions } from "./identity/identityController";
import { NavControllerIf, NavItem } from "./navigation/navigationDefinitions";
import { ControllerContext, VerityController } from "./verityController";


/** Mock for testing only */

export class DummyNavController implements NavControllerIf {
  show(navItem: NavItem, show?: boolean): Promise<void> { return new Promise<void>(resolve => { resolve(); }); }
  closeController(controllerStackIndex: number | VerityController, updateView?: boolean): void { }
  identityChanged(): Promise<boolean> { return new Promise<boolean>(resolve => { resolve(true); }); }
}

export interface DummyControllerContextOptions extends VerityNodeOptions, IdentityControllerOptions {
  node?: VerityNodeIf,
  nav?: NavControllerIf,
  identityController?: IdentityController;
  cockpit?: Cockpit,
}

export class DummyControllerContext implements ControllerContext {
  readonly node?: VerityNodeIf;
  readonly nav: NavControllerIf;
  readonly cockpit: Cockpit;
  readonly identityController: IdentityController;

  constructor(
    options: DummyControllerContextOptions = {},
  ){
    this.node = options.node ?? dummyVerityNode(options);
    this.nav = options.nav ?? new DummyNavController();
    this.cockpit = options.cockpit ?? new Cockpit(this.node, { identity: () => this.identityController?.identity ?? undefined });
    this.identityController = options.identityController ??
      new IdentityController(this, {
        ...options,
        identityPersistence: false,
        loginStatusView: false,
    });
  }
}

