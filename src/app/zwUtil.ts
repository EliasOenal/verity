/**
 * Helper functions to create uniform Cubes for our "ZW" micro-blogging
 * application.
 */

import { Settings } from "../core/settings";

import { Cube } from "../core/cube/cube";
import { CubeKey, CubeType } from "../core/cube/cubeDefinitions";

import { cciField, MediaTypes, cciFieldType } from "../cci/cube/cciField";
import { cciFields, cciFrozenFieldDefinition } from "../cci/cube/cciFields";
import { cciRelationship, cciRelationshipType } from "../cci/cube/cciRelationship";
import { cciCube, cciFamily } from "../cci/cube/cciCube";
import { Identity } from "../cci/identity/identity";
import { isCci } from "../cci/cube/cciCubeUtil";

import { Buffer } from 'buffer';

import { logger } from "../core/logger";
import { NetConstants } from "../core/networking/networkDefinitions";

/**
 * Creates a new Cube containing a correctly formed text post.
 * Don't forget to add it to your cubeStore!
 * Don't forget to call Identity.store() on your Identity object afterwards!
 * @throws When post is too large to fit Cube
 */
export async function makePost(
    text: string,
    replyto?: CubeKey,
    id?: Identity,
    requiredDifficulty = Settings.REQUIRED_DIFFICULTY): Promise<cciCube> {
  const cube: cciCube = cciCube.Frozen({  // prepare Cube
    family: cciFamily, requiredDifficulty: requiredDifficulty, fields: [
      cciField.Application(("ZW")),
      cciField.MediaType(MediaTypes.TEXT),
      cciField.Payload(text),
    ]});
  if (replyto) {  // if this is a reply, refer to the original post
    cube.fields.insertFieldBeforeBackPositionals(cciField.RelatesTo(
      new cciRelationship(cciRelationshipType.REPLY_TO, replyto)
    ));
  }
  if (id) {  // if this is not an anonymous post, refer my previous posts
    // Note: We currently just include our newest posts in our root MUC, and then include
    // reference to older posts within our new posts themselves.
    // We might need to change that again as it basically precludes us from ever
    // de-referencing ("deleting") as post.
    // previous note was: use fibonacci spacing for post references instead of linear,
    // but only if there are actually enough posts to justify it
    cube.fields.insertTillFull(cciField.FromRelationships(
      cciRelationship.fromKeys(cciRelationshipType.MYPOST, id.posts)));
  }
  await cube.getBinaryData();  // finalize Cube & compile fields
  if (id) {  // unless anonymous, have the Identity remember this new post
    id.rememberMyPost(await cube.getKey());
  }
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
  if (applicationField.value.toString() != "ZW" &&
      applicationField.value.toString() != "ID/ZW") {
    logger.trace("assertZwCube: Supplied cube does not have a ZW application string");
    return false;
  }
  return true;
}

export function assertZwMuc(cube: Cube): boolean {
  if (cube?.cubeType != CubeType.MUC) {
    logger.trace("asserZwMuc: Supplied Cube is not a ZW Muc, as it's not a MUC at all.");
  }
  else return assertZwCube(cube);
}

// maybe provide a makeMUC() function as well?
// on the other hand, there will probably no other code creating MUCs
// besides Identity.makeMUC().
