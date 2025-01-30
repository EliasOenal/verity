/**
 * Helper functions to create uniform Cubes for our "ZW" micro-blogging
 * application.
 */

import { Settings } from "../../../core/settings";
import { NetConstants } from "../../../core/networking/networkDefinitions";

import { Cube } from "../../../core/cube/cube";
import { CubeKey, CubeType } from "../../../core/cube/cube.definitions";
import { CubeStore } from "../../../core/cube/cubeStore";

import { MediaTypes, cciFieldType } from "../../../cci/cube/cciCube.definitions";
import { cciField } from "../../../cci/cube/cciField";
import { cciFields, cciFrozenFieldDefinition } from "../../../cci/cube/cciFields";
import { cciRelationship, cciRelationshipType } from "../../../cci/cube/cciRelationship";
import { cciCube, cciFamily } from "../../../cci/cube/cciCube";
import { Identity } from "../../../cci/identity/identity";
import { isCci } from "../../../cci/cube/cciCubeUtil";

import { Buffer } from 'buffer';

import { logger } from "../../../core/logger";

export interface MakePostOptions {
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
 */
export async function makePost(
    text: string,
    options: MakePostOptions = {},
): Promise<cciCube> {
  // set default options
  options.requiredDifficulty ??= Settings.REQUIRED_DIFFICULTY;
  // prepare Cube
  const cube: cciCube = cciCube.Frozen({
    family: cciFamily, requiredDifficulty: options.requiredDifficulty, fields: [
      cciField.Application(("ZW")),
      cciField.MediaType(MediaTypes.TEXT),
      cciField.Payload(text),
    ]});
  if (options.replyto) {  // if this is a reply, refer to the original post
    cube.insertFieldBeforeBackPositionals(cciField.RelatesTo(
      new cciRelationship(cciRelationshipType.REPLY_TO, options.replyto)
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
    cube.fields.insertTillFull(cciField.FromRelationships(
      cciRelationship.fromKeys(cciRelationshipType.MYPOST, newestPostsFirst)));
  }
  await cube.getBinaryData();  // finalize Cube & compile fields
  if (options.id) {  // unless anonymous, have the Identity remember this new post
    options.id.addPost(await cube.getKey());
  }
  if (options.store) await options.store.addCube(cube);
  return cube;
}

// TODO: Not using this just yet as there's this teeny tiny issue of multi-byte chars
// (Max lenght is currently defined as a conservatively eyeballed 600 chars in zwConfig)
export const maxPostSize: number =  // calculate maximum posts size by creating a mock post
  cciFields.Frozen([
    cciField.RelatesTo(  // need space for one ref if this is a reply
      new cciRelationship(cciRelationshipType.REPLY_TO, Buffer.alloc(NetConstants.CUBE_KEY_SIZE))),
    cciField.RelatesTo(  // need space for at least one reference to my older posts
      new cciRelationship(cciRelationshipType.MYPOST, Buffer.alloc(NetConstants.CUBE_KEY_SIZE))),
    cciField.RelatesTo(  // make that two for good measure
      new cciRelationship(cciRelationshipType.MYPOST, Buffer.alloc(NetConstants.CUBE_KEY_SIZE))),
  ], cciFrozenFieldDefinition).bytesRemaining();

export function assertZwCube(cube: Cube): boolean {
  if (!(isCci(cube))) {
    logger.trace("assertZwCube: Supplied object is not a CCI Cube");
    return false;
  }
  const fields: cciFields = cube?.fields as cciFields;
  if (!(fields instanceof cciFields)) {
    logger.trace("assertZwCube: Supplied Cube's fields object is not a cciFields object");
    return false;
  }
  const applicationField = fields.getFirst(cciFieldType.APPLICATION);
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

export function assertZwMuc(cube: Cube): boolean {
  if (cube?.cubeType !== CubeType.MUC &&
      cube?.cubeType !== CubeType.MUC_NOTIFY &&
      cube?.cubeType !== CubeType.PMUC &&
      cube?.cubeType !== CubeType.PMUC_NOTIFY
  ) {
    logger.trace("asserZwMuc: Supplied Cube is not a ZW Muc, as it's not a MUC at all.");
  }
  else return assertZwCube(cube);
}

// maybe provide a makeMUC() function as well?
// on the other hand, there will probably no other code creating MUCs
// besides Identity.makeMUC().
