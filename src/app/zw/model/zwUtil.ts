/**
 * Helper functions to create uniform Cubes for our "ZW" micro-blogging
 * application.
 */

import { Settings } from "../../../core/settings";
import { NetConstants } from "../../../core/networking/networkDefinitions";

import { CoreCube } from "../../../core/cube/coreCube";
import { CubeCreateOptions } from '../../../core/cube/coreCube.definitions';
import { CubeKey, CubeType } from "../../../core/cube/coreCube.definitions";
import { mergeAsyncGenerators } from "../../../core/helpers/asyncGenerators";
import { CubeStore } from "../../../core/cube/cubeStore";
import { CubeRetrievalInterface } from "../../../core/cube/cubeRetrieval.definitions";
import { logger } from "../../../core/logger";

import { MediaTypes, FieldType, FieldLength } from "../../../cci/cube/cube.definitions";
import { VerityField } from "../../../cci/cube/verityField";
import { VerityFields, cciFrozenFieldDefinition } from "../../../cci/cube/verityFields";
import { Relationship, RelationshipType } from "../../../cci/cube/relationship";
import { Cube, cciFamily } from "../../../cci/cube/cube";
import { isCci } from "../../../cci/cube/cubeUtil";
import { RetrievalFormat } from "../../../cci/veritum/veritum.definitions";
import { RecursiveRelResolvingPostInfo, RecursiveRelResolvingGetPostsGenerator } from "../../../cci/identity/identity.definitions";
import { Identity } from "../../../cci/identity/identity";
import { notifyingIdentities } from "../../../cci/identity/identityGenerators";

import { ZwConfig } from "./zwConfig";

import { Buffer } from 'buffer';

import { IdentityStore } from "../../../cci/identity/identityStore";

export interface MakePostOptions extends CubeCreateOptions {
  replyto?: CubeKey;
  id?: Identity;
  requiredDifficulty?: number;
  store?: CubeStore;
}

/**
 * Creates a new Cube containing a correctly formed text post.
 * Don't forget to add it to your cubeStore!
 * Don't forget to call Identity.store() on your Identity object afterwards!
 * @throws When post is too large to fit Cube
 * @deprecated Client should use CCI Cockpit instead
 */
// TODO move to CCI (or even better get rid of it entirely)
export async function makePost(
    text: string,
    options: MakePostOptions = {},
): Promise<Cube> {
  // set default options
  options.requiredDifficulty ??= Settings.REQUIRED_DIFFICULTY;
  // prepare Cube
  const cube: Cube = Cube.Frozen({
    family: cciFamily, requiredDifficulty: options.requiredDifficulty, fields: [
      VerityField.Application(("ZW")),
      VerityField.MediaType(MediaTypes.TEXT),
      VerityField.Payload(text),
    ]});
  if (options.replyto) {  // if this is a reply, refer to the original post
    cube.insertFieldBeforeBackPositionals(VerityField.RelatesTo(
      new Relationship(RelationshipType.REPLY_TO, options.replyto)
    ));
  }
  if (options.id) {  // if this is not an anonymous post, refer my previous posts
    // Note: We currently just include our newest posts in our root MUC, and then include
    // reference to older posts within our new posts themselves.
    // We might need to change that again as it basically precludes us from ever
    // de-referencing ("deleting") a post.
    // previous note was: use fibonacci spacing for post references instead of linear,
    // but only if there are actually enough posts to justify it
    // TODO: get rid of intermediate Array
    // TODO: find a smarter way to determine reference order than local insertion
    //   order, as local insertion order is not guaranteed to be stable when it
    //   has itself been restored from a MUC.
    const newestPostsFirst: string[] = Array.from(options.id.getPostKeyStrings()).reverse();
    cube.fields.insertTillFull(VerityField.FromRelationships(
      Relationship.fromKeys(RelationshipType.MYPOST, newestPostsFirst)));
  }
  await cube.getBinaryData();  // finalize Cube & compile fields
  if (options.store) await options.store.addCube(cube);
  if (options.id) {  // unless anonymous, have the Identity remember this new post
    options.id.addPost(await cube.getKey());
  }
  return cube;
}

// TODO: Not using this just yet as there's this teeny tiny issue of multi-byte chars
// (Max lenght is currently defined as a conservatively eyeballed 600 chars in zwConfig)
export const maxPostSize: number =  // calculate maximum posts size by creating a mock post
  VerityFields.Frozen([
    VerityField.RelatesTo(  // need space for one ref if this is a reply
      new Relationship(RelationshipType.REPLY_TO, Buffer.alloc(NetConstants.CUBE_KEY_SIZE) as CubeKey)),
    VerityField.RelatesTo(  // need space for at least one reference to my older posts
      new Relationship(RelationshipType.MYPOST, Buffer.alloc(NetConstants.CUBE_KEY_SIZE) as CubeKey)),
    VerityField.RelatesTo(  // make that two for good measure
      new Relationship(RelationshipType.MYPOST, Buffer.alloc(NetConstants.CUBE_KEY_SIZE) as CubeKey)),
  ], cciFrozenFieldDefinition).bytesRemaining();

export function assertZwCube(cube: CoreCube): boolean {
  if (!(isCci(cube))) {
    logger.trace("assertZwCube: Supplied object is not a CCI Cube");
    return false;
  }
  const fields: VerityFields = cube?.fields as VerityFields;
  if (!(fields instanceof VerityFields)) {
    logger.trace("assertZwCube: Supplied Cube's fields object is not a cciFields object");
    return false;
  }
  const applicationField = fields.getFirst(FieldType.APPLICATION);
  if (!applicationField) {
    logger.trace("assertZwCube: Supplied cube does not have an application field");
    return false;
  }
  if (applicationField.value.toString() !== "ZW" &&
      applicationField.value.toString() !== "ID/ZW" &&
      applicationField.value.toString() !== "ID"  // note: this is overly broad to be strictly considered ZW, ZW Identities should always identify as "ID/ZW". We're currently accepting just ID as there's not really a reason to stop parsing them just here.
  ){
    //logger.trace("assertZwCube: Supplied cube does not have a ZW application string");
    return false;
  }
  return true;
}

export function assertZwMuc(cube: CoreCube): boolean {
  if (cube?.cubeType !== CubeType.MUC &&
      cube?.cubeType !== CubeType.MUC_NOTIFY &&
      cube?.cubeType !== CubeType.PMUC &&
      cube?.cubeType !== CubeType.PMUC_NOTIFY
  ) {
    logger.trace("assertZwMuc: Supplied Cube is not a ZW Muc, as it's not a (P)MUC at all.");
  }
  else return assertZwCube(cube);
}

export async function isPostDisplayable(postInfo: RecursiveRelResolvingPostInfo<CoreCube>): Promise<boolean> {
  // is this even a valid ZwCube?
  const cube: CoreCube = postInfo.main;
  if (!assertZwCube(cube)) {
    logger.trace("isPostDisplayable(): Rejecting a Cube as it's not ZW");
    return false;
  }

  // does this have a Payload field and does it contain something??
  const payload = cube.getFirstField(FieldType.PAYLOAD);
  if (!payload || !payload.length) {
    logger.trace("isPostDisplayable(): Rejecting a Cube as it has no payload");
    return false;
  }

  // does it have the correct media type?
  const typefield = cube.getFirstField(FieldType.MEDIA_TYPE);
  if (!typefield) {
    logger.trace("isPostDisplayable(): Rejecting a Cube as it has no media type");
    return false;
  }
  if (typefield.value.readUIntBE(0, FieldLength[FieldType.MEDIA_TYPE]) !== MediaTypes.TEXT) {
    logger.trace("isPostDisplayable(): Rejecting a Cube as it has the wrong media type");
    return false;
  }

  // is this a reply to another post?
  // if so, has the root post been retrieved?
  await postInfo.done;
  if (!postInfo.allResolved) {
    logger.trace("isPostDisplayable(): Rejecting a Cube as it has unresolved relationships");
    return false;
  }

  return true;  // all checks passed
}


export function wotPostGenerator(
    identity: Identity,
    subscriptionDepth: number,
): RecursiveRelResolvingGetPostsGenerator<CoreCube> {
  const gen: RecursiveRelResolvingGetPostsGenerator<CoreCube> = identity.getPosts({
    subscriptionDepth,
    format: RetrievalFormat.Cube,
    metadata: true,
    subscribe: true,
    resolveRels: 'recursive',
    relTypes: [RelationshipType.REPLY_TO],
  });
  return gen;
}

export function explorePostGenerator(
    retriever: CubeRetrievalInterface,
    idStore: IdentityStore,
): RecursiveRelResolvingGetPostsGenerator<CoreCube> {
  // start an endless fetch of ZW Identities and store them all in a list
  const postGenerator = mergeAsyncGenerators() as RecursiveRelResolvingGetPostsGenerator<CoreCube>;
  postGenerator.setEndless();

  const identityGen: AsyncGenerator<Identity> = notifyingIdentities(
    retriever,
    ZwConfig.NOTIFICATION_KEY,
    idStore,
    { subscribe: true },
  );
  (async() => {
    for await (const identity of identityGen) {
      const postsGen: RecursiveRelResolvingGetPostsGenerator<CoreCube> =
        identity.getPosts({
          subscriptionDepth: 0,
          format: RetrievalFormat.Cube,
          metadata: true,
          subscribe: true,
          resolveRels: 'recursive',
          relTypes: [RelationshipType.REPLY_TO],
        });
      postGenerator.addInputGenerator(postsGen);
    }
  })();

  // TODO stop generators on teardown
  // maybe TODO: expose getting posts from multiple Identities as a common
  //   IdentityUtil building block. Maybe introduce a new class IdentityGroup
  //   following Identity's API for getting posts and subscriptions from all
  //   group members.

  return postGenerator;
}
