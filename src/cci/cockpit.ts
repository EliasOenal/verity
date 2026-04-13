import type { CubeKey, NotificationKey } from "../core/cube/coreCube.definitions";
import type { CubeRequestOptions } from "../core/networking/cubeRetrieval/requestScheduler";
import type { CoreVeritable } from "../core/cube/coreVeritable.definition";
import type { CubeCreateOptions } from '../core/cube/coreCube.definitions';
import type { CoreCube } from "../core/cube/coreCube";
import type { CubeInfo } from "../core/cube/cubeInfo";
import type { CubeStore } from "../core/cube/cubeStore";

import { asCubeKey } from "../core/cube/keyUtil";
import { FieldPosition } from "../core/fields/baseFields";

import type { Cube } from "./cube/cube";
import type { Identity } from "./identity/identity";
import type { ChunkFinalisationState, VeritumCompileOptions } from "./veritum/veritum.definitions";
import type { GetVeritumOptions, VeritumRetrievalInterface } from "./veritum/veritumRetriever";
import type { MetadataEnhancedRetrieval, ResolveRelsOptions, ResolveRelsRecursiveOptions, ResolveRelsRecursiveResult, ResolveRelsResult } from "./veritum/veritumRetrievalUtil";

import { dummyVerityNode, VerityNodeIf, VerityNodeOptions } from "./verityNode";
import { Relationship, RelationshipType } from "./cube/relationship";
import { VerityField } from "./cube/verityField";
import { Veritum } from "./veritum/veritum";
import { MIN_POST_REFS } from "./identity/identity.definitions";

export interface CockpitOptions {
  identity?: Identity | (() => Identity);
}

export interface PublishVeritumOptions extends VeritumCompileOptions {
  /**
   * Whether to add the veritum as a public post to the user's Identity
   * @default true
   */
  addAsPost?: boolean;

  /**
   * Whether to add an AUTHORHINT relationship field to the Veritum,
   * pointing to the publishing Identity.
   * This obviously requires that an Identity is used to publish the Veritum.
   * Should only be used in combination with addAsPost, as author hints
   * are supposed to be disregarded unless corroborated by a corresponding MYPOST
   * relationship from the Identity.
   * @default - follows addAsPost, which itself defaults to true
   */
  addAuthorHint?: boolean;

  /**
   * If enabled, enrich this Veritum with referrences to previous posts.
   * This only works if the user is logged in, i.e. this Cockpit has a valid
   * Identity object.
   * We will add a minimum of post references as per the number supplied
   * (even if this extends the Veritum by an extra Cube), and on top of that
   * we'll try to fill up the remaining space in the last chunk with even
   * more references.
   * @default - Enabled with a minimum of MIN_POST_REF refs if logged in
  */
  includePreviousPostRefs?: number|boolean;

  /**
   * The Identity this Cockpit belongs to
   * (in most use cases that means the currently logged in user).
   * Cockpits can also be used anonymously, in which case they will obviously
   * lack Identity integration features such as indexing published Verita
   * as public posts.
   * @default undefined
   */
  identity?: Identity;
}

export class Cockpit implements VeritumRetrievalInterface {
  constructor(
      public node: VerityNodeIf,
      readonly options: CockpitOptions = {},
  ) {
  }

  get cubeStore(): CubeStore { return this.node.cubeStore }

  get identity(): Identity {
    if (typeof this.options.identity === 'function') return this.options.identity();
    else return this.options.identity;
  }

  /**
   * Creates a new Veritum without publishing it;
   * it can later be published by calling publishVeritum.
   * Note that you can alternatively create and publish a Veritum in one go
   * by calling publishVeritum directly.
   */
  prepareVeritum(options: CubeCreateOptions = {}): Veritum {
    options = { ...options };  // copy options to avoid tainting passed object
    if (this.identity) {
      // TODO: Provide automatic key derivation for signed Verita.
      //   We have not decided yet whether we even want to support multi-chunk
      //   signed Verita, Github#634.
    }
    const veritum = new Veritum(options);
    return veritum;
  }

  /**
   * Publish an existing Veritum.
   **/
  publishVeritum(veritum:CoreVeritable, options?: PublishVeritumOptions): Promise<Veritum>;
  /**
   * Create and publish a new Veritum.
   */
  publishVeritum(options: PublishVeritumOptions): Promise<Veritum>;

  // maybe TODO: Ensure Cubes have actually been synced to the network?
  publishVeritum(param1:CoreVeritable|PublishVeritumOptions, param2: PublishVeritumOptions = {}): Promise<Veritum> {
    let veritum: Veritum;
    let options: PublishVeritumOptions;
    if (param1 instanceof Veritum) {
      options = {...param2};
      veritum = param1;
    } else {
      options = {...param1};
      veritum = this.prepareVeritum(options);
    }

    // Set default options
    options.addAsPost ??= true;
    options.addAuthorHint ??= options.addAsPost;
    // Use this cockpit's identity by default.
    // Besides allowing overrides, this assignment also ensures the Identity
    // cannot change while this call is in progress (Cockpit supports Identity changes).
    options.identity = this.identity;
    options.includePreviousPostRefs ??=
      options.identity? MIN_POST_REFS : false;
    if (
      options.includePreviousPostRefs !== false &&
      !Number.isInteger(options.includePreviousPostRefs))
    {
      options.includePreviousPostRefs = MIN_POST_REFS;
    };

    // Add AUTHORHINT relationship if requested and we have an identity
    if (options.identity && options.addAuthorHint) {
      const authorHintRel = new Relationship(RelationshipType.AUTHORHINT, options.identity.key);
      const authorHintField = VerityField.RelatesTo(authorHintRel);
      veritum.insertField(FieldPosition.AFTER_FRONT_POSITIONALS, authorHintField);
    }

    // maybe TODO: When encryption is enabled, auto-add self as additional recipient
    //   by default? Sculpting Verita not readable by self seems like a trap.

    // If the user is logged in, enrich the Veritum with past post references
    // (TODO make configurable)
    if (options.includePreviousPostRefs && options.identity) {
      // Prepare list of post back refs
      // TODO: find a smarter way to determine reference order than local insertion
      //   order, as local insertion order is not guaranteed to be stable when it
      //   has itself been restored from a MUC.
      const postKeys: CubeKey[] =
        Array.from(options.identity.getPostKeys());

      // first add the minimum of back refs prior to compilation
      for (let i=0; i<(options.includePreviousPostRefs as number); i++) {
        const ref: CubeKey = postKeys.pop();
        if (ref !== undefined) veritum.insertFieldBeforeBackPositionals(
          VerityField.RelatesTo(RelationshipType.MYPOST, ref)
        );
      }

      // later while compiling, fill up the last chunks with further back refs
      const originalChunkTransformationCallback = options.chunkTransformationCallback;
      options.chunkTransformationCallback = (chunk: Cube, splitState: ChunkFinalisationState) => {
        originalChunkTransformationCallback?.(chunk, splitState);
        const reversePostKeys = postKeys.reverse();
        if (splitState.chunkIndex === splitState.chunkCount -1) {  // last chunk only
          chunk.insertTillFull(VerityField.FromRelationships(
            Relationship.fromKeys(RelationshipType.MYPOST, reversePostKeys)));
        }
      }
    }

    // Compile the Veritum
    // TODO BUGBUG should not recompile the Veritum if already compiled (may change key!)
    return veritum.compile(options).then(() => {
      const promises: Promise<any>[] = [];
      // If the user is logged in (and did not opt out), store this as a post
      if (options.identity && options.addAsPost) {
        promises.push(
          veritum.getKey().then((key): Promise<any> => {
            options.identity.addPost(key);
            return options.identity.store();
          })
        );
      }
      // Publish the Veritum by adding all Cubes to the CubeStore
      for (const chunk of veritum.chunks) {
        promises.push(this.node.cubeStore.addCube(chunk));
      }
      // Return resolved once all chunks have been published
      return Promise.all(promises).then(() => veritum);
    });
  }

  getVeritum(
      key: CubeKey | string,
      options: {resolveRels: true, metadata?: true} & CubeRequestOptions & GetVeritumOptions & ResolveRelsOptions,
  ): Promise<ResolveRelsResult>;
  getVeritum(
      key: CubeKey | string,
      options: {resolveRels: 'recursive', metadata?: true} & CubeRequestOptions & GetVeritumOptions & ResolveRelsRecursiveOptions,
  ): Promise<ResolveRelsRecursiveResult>;
  getVeritum(
      key: CubeKey | string,
      options: {metadata: true} & CubeRequestOptions & GetVeritumOptions & ResolveRelsRecursiveOptions,
  ): Promise<MetadataEnhancedRetrieval<Veritum>>;
  getVeritum(
      key: CubeKey | string,
      options?: CubeRequestOptions & GetVeritumOptions
  ): Promise<Veritum>;
  getVeritum(
      key: CubeKey,
      options: CubeRequestOptions & GetVeritumOptions = {},
  ): Promise<Veritum|ResolveRelsResult|ResolveRelsRecursiveResult|MetadataEnhancedRetrieval<Veritum>> {
    const ret: Promise<Veritum|ResolveRelsResult|ResolveRelsRecursiveResult|MetadataEnhancedRetrieval<Veritum>> =
      this.node.veritumRetriever.getVeritum(key,
        {
          ...options,
          recipient: this.identity,
        }
    );
    return ret;
  }


  // Pass-through method to implement CubeRetrievalInterface
  getCubeInfo(keyInput: CubeKey | string): Promise<CubeInfo> {
    return this.node.veritumRetriever.getCubeInfo(keyInput);
  }
  // Pass-through method to implement CubeRetrievalInterface --
  // TODO: implement enhancement features like auto-decrypt
  getCube<cubeClass extends CoreCube = Cube>(
    key: CubeKey | string,
    options: {resolveRels: true, metadata?: true} & GetVeritumOptions & ResolveRelsOptions,
  ): Promise<ResolveRelsResult>;
  getCube<cubeClass extends CoreCube = Cube>(
      key: CubeKey | string,
      options: {resolveRels: 'recursive', metadata?: true} & GetVeritumOptions & ResolveRelsRecursiveOptions,
  ): Promise<ResolveRelsRecursiveResult>;
  getCube<cubeClass extends CoreCube = Cube>(
    key: CubeKey | string,
    options: {metadata: true} & GetVeritumOptions & ResolveRelsRecursiveOptions,
  ): Promise<MetadataEnhancedRetrieval<CoreCube>>;
  getCube<cubeClass extends CoreCube = Cube>(
      key: CubeKey | string,
      options?: GetVeritumOptions
  ): Promise<cubeClass>;
  getCube<cubeClass extends CoreCube = Cube>(
      key: CubeKey | string,
      options?: CubeRequestOptions,
  ): Promise<cubeClass|ResolveRelsResult|ResolveRelsRecursiveResult|MetadataEnhancedRetrieval<CoreCube>> {
    return this.node.veritumRetriever.getCube(key, options);
  }
  // Pass-through method to implement CubeRetrievalInterface
  expectCube(keyInput: CubeKey | string): Promise<CubeInfo> {
    return this.node.cubeStore.expectCube(asCubeKey(keyInput));
  }
  // Pass-through method to implement CubeRetrievalInterface --
  // TODO: implement enhancement features like auto-decrypt
  getNotifications(recipientKey: NotificationKey | string): AsyncGenerator<CoreVeritable> {
    return this.node.veritumRetriever.getNotifications(recipientKey);
  }

  // Pass-through method to implement VeritumRetrievalInterface
  subscribeNotifications(recipientKey: NotificationKey | string, options?: any): any {
    return this.node.veritumRetriever.subscribeNotifications(recipientKey, options);
  }

}

/**
 * For testing only:
 * Assemble a dummy Cockpit, i.e. one based on a node with a DummyNetworkManager.
 */
export function dummyCockpit(options: CockpitOptions|VerityNodeOptions = {}): Cockpit {
  const node = dummyVerityNode(options as VerityNodeOptions);
  return new Cockpit(node, options as CockpitOptions);
}
