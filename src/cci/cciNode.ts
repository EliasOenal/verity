import { CubeRequestOptions } from "../core/networking/cubeRetrieval/requestScheduler";
import { DummyVerityNode, VerityNode, VerityNodeIf, VerityNodeOptions } from "../core/verityNode";
import { VeritumRetriever } from "./veritum/veritumRetriever";

export interface cciNodeIf extends VerityNodeIf {
  veritumRetriever: VeritumRetriever<any>;
}

export class cciNode extends VerityNode {
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
export class DummyCciNode extends DummyVerityNode implements VerityNodeIf {
  readonly veritumRetriever: VeritumRetriever<CubeRequestOptions>;

  constructor(options: VerityNodeOptions = {}){
    super(options);
    this.veritumRetriever = new VeritumRetriever(this.cubeRetriever);
  }
}
