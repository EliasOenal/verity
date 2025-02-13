import { Cockpit } from "../../../src/cci/cockpit";
import { cciFamily } from "../../../src/cci/cube/cciCube";
import { Identity } from "../../../src/cci/identity/identity";
import { coreCubeFamily } from "../../../src/core/cube/cube";
import { NetConstants } from "../../../src/core/networking/networkDefinitions";
import { VerityNode, VerityNodeOptions } from "../../../src/core/verityNode";
import { LineShapedNetwork } from "../../core/e2e/e2eSetup";
import { testCoreOptions } from "../../core/testcore.definition";

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

export const cciTestOptions: VerityNodeOptions = {
  ...testCoreOptions,
  family: [cciFamily, coreCubeFamily],
}

export class cciLineShapedNetwork {
  constructor(
    public sender: Cockpit,
    public fullNode1: VerityNode,
    public fullNode2: VerityNode,
    public recipient: Cockpit,
  ) {}

  static async Create(fullNode1Port: number, fullNode2Port: number): Promise<cciLineShapedNetwork> {
    const core = await LineShapedNetwork.Create(fullNode1Port, fullNode2Port);

    // make sender
    const senderId: Identity = await Identity.Construct(
      core.sender.cubeRetriever, Buffer.alloc(
        NetConstants.CUBE_KEY_SIZE, 0x42));
    const sender: Cockpit = new Cockpit(core.sender, { identity: senderId });

    // make recipient
    const recipientId: Identity = await Identity.Construct(
      core.sender.cubeRetriever, Buffer.alloc(
        NetConstants.CUBE_KEY_SIZE, 0x1337));
    const recipient: Cockpit = new Cockpit(core.sender,  { identity: senderId });

    // bring it all together
    const ret = new this(sender, core.fullNode1, core.fullNode2, recipient);
    return ret;
  }
}
