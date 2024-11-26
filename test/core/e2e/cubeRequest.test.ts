import { Cube } from "../../../src/core/cube/cube";
import { CubeFieldType, CubeKey, CubeType } from "../../../src/core/cube/cube.definitions";
import { CubeField } from "../../../src/core/cube/cubeField";
import { CubeFields } from "../../../src/core/cube/cubeFields";
import { CubeStore } from "../../../src/core/cube/cubeStore";
import { requiredDifficulty } from "../testcore.definition";
import { LineShapedNetwork } from "./e2eSetup";

describe('Cube request e2e tests', () => {
    let net: LineShapedNetwork;
    let cube: Cube;
    let key: CubeKey;

    beforeEach(async () => {
      // prepare a test network
      net = await LineShapedNetwork.Create(61301, 61302);
    });

    it.skip('can request a Cube before it is published', async () => {
      const content = "cubus sum";
      cube = Cube.Create({
        cubeType: CubeType.FROZEN,
        fields: CubeField.RawContent(CubeType.FROZEN, content),
        requiredDifficulty,
      });
      key = await cube.getKey();

      const req = net.recipient.networkManager.scheduler.requestCube(key);
      await new Promise(resolve => setTimeout(resolve, 1000));

      await net.sender.cubeStore.addCube(cube);

      const received: Cube = (await req).getCube();
      expect(received.getFirstField(CubeFieldType.FROZEN_RAWCONTENT).valueString).
        toContain(content);
    });
});
