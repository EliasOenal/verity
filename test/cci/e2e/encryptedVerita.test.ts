import { cciCube } from "../../../src/cci/cube/cciCube";
import { cciFieldType } from "../../../src/cci/cube/cciCube.definitions";
import { cciField } from "../../../src/cci/cube/cciField";
import { Identity } from "../../../src/cci/identity/identity";
import { Veritum } from "../../../src/cci/veritum/veritum";
import { cciLineShapedNetwork } from "./e2eCciSetup";

describe('Transmission of encrypted Verita', () => {
    describe('Publishing and encrypted Veritum for a single recipient', () => {
    let net: cciLineShapedNetwork;
    const plaintext = "Nuntius secretus quem nemo praeter te legere potest";

    beforeAll(async () => {
      // Create a simple line-shaped network
      net = await cciLineShapedNetwork.Create(61201, 61202);
      // Sculpt a simple Veritum for a single recipient
      const veritum: Veritum = net.sender.makeVeritum(
        { fields: cciField.Payload(plaintext) });
      // Publish it encrypted solely for the recipient
      await net.sender.publishVeritum(
        veritum, { recipients: net.recipient.identity });
      // Reference Veritum thorugh Identity MUC --
      // TODO: do that automatically (opt-in or opt-out) through publishVeritum()
      net.sender.identity.rememberMyPost(veritum.getKeyIfAvailable());
      await net.sender.identity.store();

      // give it some time to propagate
      // TODO: remove once CubeRetriever handles retries properly
      await new Promise(resolve => setTimeout(resolve, 500));
    });

    test('recipient receives and decrypts Veritum', async() => {
      // Recipient learns about sender out of band and subscribes to them
      // TODO: expose this though a simplified cciCockpit API
      const sub: Identity = await Identity.Construct(
        net.recipient.node.cubeRetriever,
        await net.recipient.node.cubeRetriever.getCube(net.sender.identity.key) as cciCube
      );
      expect(sub.posts).toHaveLength(1);
      const retrieved: Veritum = await net.recipient.getVeritum(sub.posts[0]);
      expect(retrieved).toBeDefined();
      expect(retrieved.getFirstField(cciFieldType.PAYLOAD).valueString).toBe(plaintext);
    });
  });
});
