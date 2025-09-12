import { Cockpit } from "../../../src/cci/cockpit";
import { Identity } from "../../../src/cci/identity/identity";
import { NetConstants } from "../../../src/core/networking/networkDefinitions";
import { CoreNode } from "../../../src/core/coreNode";

import { testCciOptions } from "../testcci.definitions";
import { LineShapedNetwork } from "../../core/e2e/e2eSetup";

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

export class cciLineShapedNetwork {
  constructor(
    public sender: Cockpit,
    public fullNode1: CoreNode,
    public fullNode2: CoreNode,
    public recipient: Cockpit,
  ) {}

  static async Create(fullNode1Port: number, fullNode2Port: number): Promise<cciLineShapedNetwork> {
    const core = await LineShapedNetwork.Create(
      fullNode1Port,
      fullNode2Port,
      {
        ...testCciOptions,
      }
    );

    // make sender
    const senderId: Identity = await Identity.Construct(
      core.sender.cubeRetriever, Buffer.alloc(
        NetConstants.CUBE_KEY_SIZE, 0x42));
    const sender: Cockpit = new Cockpit(core.sender, { identity: senderId });

    // make recipient
    const recipientId: Identity = await Identity.Construct(
      core.recipient.cubeRetriever, Buffer.alloc(
        NetConstants.CUBE_KEY_SIZE, 0x1337));
    const recipient: Cockpit = new Cockpit(core.recipient,  { identity: recipientId });

    // bring it all together
    const ret = new this(sender, core.fullNode1, core.fullNode2, recipient);
    return ret;
  }
}
