import { Cube } from "../../../src/core/cube/cube";
import { CubeFieldType, CubeKey, CubeType } from "../../../src/core/cube/cube.definitions";
import { CubeField } from "../../../src/core/cube/cubeField";
import { CubeFields } from "../../../src/core/cube/cubeFields";
import { CubeStore } from "../../../src/core/cube/cubeStore";
import { requiredDifficulty } from "../testcore.definition";
import { LineShapedNetwork } from "./e2eSetup";

describe('Cube request e2e tests', () => {
    let net: LineShapedNetwork;

    beforeEach(async () => {
      // prepare a test network
      net = await LineShapedNetwork.Create(61301, 61302);
    });

    afterEach(async () => {
      await net.shutdown();
    });

    it('can request a Cube from the other end of the network', async () => {
      const cube = testCube();
      const key = await cube.getKey();
      await net.sender.cubeStore.addCube(cube);
      await new Promise(resolve => setTimeout(resolve, 200));

      const req = net.recipient.networkManager.scheduler.requestCube(key);
      const received: Cube = (await req).getCube();
      expect(received.getFirstField(CubeFieldType.FROZEN_RAWCONTENT).valueString).
        toContain("cubus sum");
    });

    it.skip('can request a Cube before it is published', async () => {
      const cube = testCube();
      const key = await cube.getKey();

      const req = net.recipient.networkManager.scheduler.requestCube(key);
      await new Promise(resolve => setTimeout(resolve, 1000));

      await net.sender.cubeStore.addCube(cube);

      const received: Cube = (await req).getCube();
      expect(received.getFirstField(CubeFieldType.FROZEN_RAWCONTENT).valueString).
        toContain("cubus sum");
    });
});


function testCube(): Cube {
  const content = "cubus sum";
  const cube = Cube.Create({
    cubeType: CubeType.FROZEN,
    fields: CubeField.RawContent(CubeType.FROZEN, content),
    requiredDifficulty,
  });

  return cube;
}
