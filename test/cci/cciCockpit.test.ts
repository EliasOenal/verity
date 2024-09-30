import { cciCockpit } from "../../src/cci/cockpit";
import { cciFieldType } from "../../src/cci/cube/cciCube.definitions";
import { cciField } from "../../src/cci/cube/cciField";
import { Identity } from "../../src/cci/identity/identity";
import { Veritum } from "../../src/cci/veritum/veritum";
import { CubeType } from "../../src/core/cube/cube.definitions";
import { NetConstants } from "../../src/core/networking/networkDefinitions";
import { DummyVerityNode, VerityNodeIf } from "../../src/core/verityNode";

const masterKeySize = 32;  // must match libsodium's crypto_sign_SEEDBYTES
const masterKey = Buffer.alloc(masterKeySize, 42);
const remote1MasterKey = Buffer.alloc(masterKeySize, 47);
const remote2MasterKey = Buffer.alloc(masterKeySize, 11);
const requiredDifficulty = 0;
const idTestOptions = {
  minMucRebuildDelay: 1,  // allow updating Identity MUCs every second
  requiredDifficulty: requiredDifficulty,
  argonCpuHardness: 1,  // == crypto_pwhash_OPSLIMIT_MIN (sodium not ready)
  argonMemoryHardness: 8192, // == sodium.crypto_pwhash_MEMLIMIT_MIN (sodium not ready)
};

const tooLong = "Gallia est omnis divisa in partes tres, quarum unam incolunt Belgae, aliam Aquitani, tertiam qui ipsorum lingua Celtae, nostra Galli appellantur. Hi omnes lingua, institutis, legibus inter se differunt. Gallos ab Aquitanis Garumna flumen, a Belgis Matrona et Sequana dividit. Horum omnium fortissimi sunt Belgae, propterea quod a cultu atque humanitate provinciae longissime absunt, minimeque ad eos mercatores saepe commeant atque ea quae ad effeminandos animos pertinent important, proximique sunt Germanis, qui trans Rhenum incolunt, quibuscum continenter bellum gerunt. Qua de causa Helvetii quoque reliquos Gallos virtute praecedunt, quod fere cotidianis proeliis cum Germanis contendunt, cum aut suis finibus eos prohibent aut ipsi in eorum finibus bellum gerunt. Eorum una pars, quam Gallos obtinere dictum est, initium capit a flumine Rhodano, continetur Garumna flumine, Oceano, finibus Belgarum, attingit etiam ab Sequanis et Helvetiis flumen Rhenum, vergit ad septentriones. Belgae ab extremis Galliae finibus oriuntur, pertinent ad inferiorem partem fluminis Rheni, spectant in septentrionem et orientem solem. Aquitania a Garumna flumine ad Pyrenaeos montes et eam partem Oceani quae est ad Hispaniam pertinet; spectat inter occasum solis et septentriones.";

describe('cci Cockpit', () => {
  let node: VerityNodeIf;
  let identity: Identity;
  let remote1: Identity;
  let remote2: Identity;
  let cockpit: cciCockpit;

  beforeEach(async () => {
    node = new DummyVerityNode();
    await node.readyPromise;
    identity = new Identity(node.cubeStore, masterKey, idTestOptions);
    remote1 = new Identity(node.cubeStore, remote1MasterKey, idTestOptions);
    remote2 = new Identity(node.cubeStore, remote2MasterKey, idTestOptions);
    cockpit = new cciCockpit(node, identity);
  });

  afterEach(async () => {
    await node.shutdown();
  });

  describe('makeVeritum()', () => {
    it('can create frozen Verita', () => {
      const veritum = cockpit.makeVeritum(CubeType.FROZEN, {
        fields: cciField.Payload("Hoc veritum breve et congelatum est"),
        requiredDifficulty: requiredDifficulty,
      });
      expect(veritum.cubeType).toBe(CubeType.FROZEN);
      expect(veritum.getFirstField(cciFieldType.PAYLOAD).valueString).toEqual(
        "Hoc veritum breve et congelatum est");
    });

    // Note / TODO somewhere else: Continuation doesn't actually handle MUC subkey derivation yet
    it('can create MUC Verita', () => {
      const veritum = cockpit.makeVeritum(CubeType.MUC, {
        fields: cciField.Payload("Hoc veritum breve sed mutabile est"),
        requiredDifficulty: requiredDifficulty,
      });
      expect(veritum.cubeType).toBe(CubeType.MUC);
      expect(veritum.publicKey).toBe(identity.key);
      expect(veritum.privateKey).toBe(identity.privateKey);
      expect(veritum.getFirstField(cciFieldType.PAYLOAD).valueString).toEqual(
        "Hoc veritum breve sed mutabile est");
    });
  });

  describe('publishVeritum()', () => {
    it('adds all chunks of a multi-Chunk Veritum to the local CubeStore', async() => {
      const veritum = cockpit.makeVeritum(CubeType.FROZEN, {
        fields: cciField.Payload(tooLong),
        requiredDifficulty: requiredDifficulty,
      });
      await cockpit.publishVeritum(veritum);

      const chunks = Array.from(veritum.compiled);
      expect(chunks.length).toBeGreaterThan(1);

      for (const chunk of chunks) {
        const cube = await node.cubeStore.getCube(chunk.getKeyIfAvailable());
        expect(cube).toEqual(chunk);
      }
    });

    it('can encrypt the Veritum for a single recipient', async() => {
      const latinBraggery = "Hoc veritum breve et cryptatum est";
      const veritum = cockpit.makeVeritum(CubeType.FROZEN, {
        fields: cciField.Payload(latinBraggery),
        requiredDifficulty,
      });
      await cockpit.publishVeritum(veritum, {
        encryptionRecipients: remote1,
      })
      // the (single) chunk must have an ENCRYPTED field but no PAYLOAD field
      expect(veritum.compiled[0].getFirstField(cciFieldType.ENCRYPTED)).toBeDefined();
      expect(veritum.compiled[0].getFirstField(cciFieldType.PAYLOAD)).toBeUndefined();

      // the encrypted compiled Verium must be decryptable by the recipient
      const restored = Veritum.FromChunks(veritum.compiled);
      restored.decrypt(remote1.encryptionPrivateKey, identity.encryptionPublicKey);
      // now we must be back to a PAYLOAD field but no ENCRYPTED field
      expect(restored.getFirstField(cciFieldType.PAYLOAD)).toBeDefined();
      expect(restored.getFirstField(cciFieldType.ENCRYPTED)).toBeUndefined();
      expect(restored.getFirstField(cciFieldType.PAYLOAD).valueString).toEqual(latinBraggery);
    });

    it.todo('can create an encrypted Veritum for multiple recipients');

  });

  describe('getVeritum()', () => {
    it('restores a multi-Chunk frozen Veritum from the local CubeStore', async () => {
      // prepare Veritum
      const veritum = new Veritum(CubeType.FROZEN, {
        fields: cciField.Payload(tooLong), requiredDifficulty,
      });
      await veritum.compile();
      expect(Array.from(veritum.compiled).length).toBeGreaterThan(1);
      const key = veritum.getKeyIfAvailable();
      expect(key.length).toBe(NetConstants.CUBE_KEY_SIZE);

      // publish Veritum
      for (const chunk of veritum.compiled) await node.cubeStore.addCube(chunk);

      // perform test
      const restored: Veritum = await cockpit.getVeritum(veritum.getKeyIfAvailable());
      expect(restored.equals(veritum)).toBe(true);
    });

    it("automatically decrypts a single-chunk encrypted Veritum if sender's public key is included", async() => {
      // prepare Veritum
      const latinBraggery = "Hoc veritum breve et cryptatum est";
      const veritum = new Veritum(CubeType.FROZEN, {
        fields: cciField.Payload(latinBraggery),
        requiredDifficulty,
      });
      await veritum.compile({
        includeSenderPubkey: remote1.encryptionPublicKey,
        encryptionPrivateKey: remote1.encryptionPrivateKey,
        encryptionRecipients: identity,
      })

      // expect compiled veritum to be encrypted
      expect(veritum.compiled[0].getFirstField(cciFieldType.ENCRYPTED)).toBeDefined();
      expect(veritum.compiled[0].getFirstField(cciFieldType.PAYLOAD)).toBeUndefined();

      // publish Veritum
      await node.cubeStore.addCube(veritum.compiled[0]);

      // perform test
      const restored: Veritum = await cockpit.getVeritum(
        veritum.getKeyIfAvailable(),
        { senderPublicKey: remote1.encryptionPublicKey }
      );
      expect(restored.getFirstField(cciFieldType.PAYLOAD).valueString).toEqual(
        latinBraggery);
    });

    // TODO figure out why this still fails
    it.skip("automatically decrypts a multi-chunk encrypted Veritum if sender's public key is included", async() => {
      // prepare Veritum
      const veritum = new Veritum(CubeType.FROZEN, {
        fields: cciField.Payload(tooLong),
        requiredDifficulty,
      });
      await veritum.compile({
        includeSenderPubkey: remote1.encryptionPublicKey,
        privateKey: remote1.encryptionPrivateKey,
        encryptionRecipients: identity,
      })

      // expect compiled veritum to be encrypted
      expect(veritum.compiled[0].getFirstField(cciFieldType.ENCRYPTED)).toBeDefined();
      expect(veritum.compiled[0].getFirstField(cciFieldType.PAYLOAD)).toBeUndefined();

      // publish Veritum
      for (const chunk of veritum.compiled) await node.cubeStore.addCube(chunk);

      // perform test
      const restored: Veritum = await cockpit.getVeritum(
        veritum.getKeyIfAvailable(),
        { senderPublicKey: remote1.encryptionPublicKey }
      );
      expect(restored.getFirstField(cciFieldType.PAYLOAD).valueString).toEqual(
        tooLong);
    });
  });

});