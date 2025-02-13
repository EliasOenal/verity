import { CubeRequestOptions } from "../core/networking/cubeRetrieval/requestScheduler";
import { DummyCoreNode, CoreNode, CoreNodeIf, CoreNodeOptions } from "../core/coreNode";
import { VeritumRetriever } from "./veritum/veritumRetriever";

export interface VerityNodeIf extends CoreNodeIf {
  veritumRetriever: VeritumRetriever<any>;
}

export interface VerityNodeOptions extends CoreNodeOptions {
}

export class VerityNode extends CoreNode {
  readonly veritumRetriever: VeritumRetriever<CubeRequestOptions>;

  constructor(options: VerityNodeOptions = {}){
    super(options);
    this.veritumRetriever = new VeritumRetriever(this.cubeRetriever);
  }

  shutdown(): Promise<void> {
    return Promise.all([
      this.veritumRetriever.shutdown(),
      super.shutdown(),
    ]).then();
  }
}

/** Dummy for testing only */
export class DummyVerityNode extends DummyCoreNode implements CoreNodeIf {
  readonly veritumRetriever: VeritumRetriever<CubeRequestOptions>;

  constructor(options: VerityNodeOptions = {}){
    super(options);
    this.veritumRetriever = new VeritumRetriever(this.cubeRetriever);
  }
}
