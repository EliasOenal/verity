import { Cockpit } from "../cci/cockpit";
import { VerityNodeIf, dummyVerityNode } from "../cci/verityNode";
import { IdentityController } from "./identity/identityController";
import { NavControllerIf, NavItem } from "./navigation/navigationDefinitions";
import { ControllerContext, VerityController } from "./verityController";


/** Mock for testing only */

export class DummyNavController implements NavControllerIf {
  show(navItem: NavItem, show?: boolean): Promise<void> { return new Promise<void>(resolve => { resolve(); }); }
  closeController(controllerStackIndex: number | VerityController, updateView?: boolean): void { }
  identityChanged(): Promise<boolean> { return new Promise<boolean>(resolve => { resolve(true); }); }
}
export class DummyControllerContext implements ControllerContext {
  node?: VerityNodeIf;

  constructor(
    node: VerityNodeIf = dummyVerityNode(),
    public readonly nav: NavControllerIf = new DummyNavController(),
    public readonly cockpit: Cockpit = new Cockpit(node, { identity: () => this.identityController.identity }),
    public readonly identityController: IdentityController =
      // @ts-ignore Using this from within a constructor -- trust me, it's fine
      new IdentityController(this, {
        identityPersistence: false,
        loginStatusView: false,
      })
  ){
    this.node = node;
  }
}

