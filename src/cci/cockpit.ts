import { CubeCreateOptions } from "../core/cube/cube";
import { CubeKey, CubeType } from "../core/cube/cube.definitions";
import { ArrayFromAsync } from "../core/helpers/misc";
import { VerityNodeIf } from "../core/verityNode";
import { cciCube } from "./cube/cciCube";
import { Identity } from "./identity/identity";
import { Continuation } from "./veritum/continuation";
import { Veritum } from "./veritum/veritum";

export class cciCockpit {
  constructor(
      public node: VerityNodeIf,
      public identity: Identity,
  ) {
  }

  // maybe TODO: set a default CubeType? PIC maybe?
  makeVeritum(cubeType: CubeType, options: CubeCreateOptions = {}): Veritum {
    options = { ...options };  // copy options to avoid tainting passed object
    if (this.identity) {
      options.publicKey ??= this.identity.publicKey;
      options.privateKey ??= this.identity.privateKey;
    }
    return new Veritum(cubeType, options);
  }

  // maybe TODO: Ensure Cubes have actually been synced to the network?
  publishVeritum(veritum: Veritum): Promise<void> {
    return new Promise<void>(resolve => {
      veritum.compile().then(() => {
        const promises: Promise<any>[] = [];
        for (const cube of veritum.compiled) {
          promises.push(this.node.cubeStore.addCube(cube));
        }
        Promise.all(promises).then(() => resolve());
      });
    });
  }

  async getVeritum(
      key: CubeKey,
      options: {autoDecrypt?: boolean} = {autoDecrypt: true},
  ): Promise<Veritum> {
    const chunkGen: AsyncGenerator<cciCube> =
      this.node.cubeRetriever.getContinuationChunks(key);
    // maybe TODO: get rid of ugly Array conversion?
    const chunks: Iterable<cciCube> = await ArrayFromAsync(chunkGen);
    const veritum = Continuation.Recombine(chunks);
    if (this.identity && options.autoDecrypt) {
      // TODO auto-decrypt with ENCRYPTION privkey
      // veritum.decrypt(...);
    }
    return veritum;
  }
}
