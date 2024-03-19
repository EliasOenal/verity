/**
 * Helper functions to create standard "ZW" cubes as used by our micro-blogging
 * application.
 * These are standard cubes, not even Cube subclasses.
 * They just follow a standardized field structure.
 */

import { Settings } from "../core/settings";
import { Cube } from "../core/cube/cube";
import { CubeKey, CubeType } from "../core/cube/cubeDefinitions";
import { Identity } from "../cci/identity/identity";
import { MediaTypes, cciField, cciFieldType, cciFields, cciRelationship, cciRelationshipType, cciFrozenFieldDefinition } from "../cci/cube/cciFields";

import { Buffer } from 'buffer';
import { cciCube, cciFamily } from "../cci/cube/cciCube";
import { logger } from "../core/logger";
import { isCci } from "../cci/cube/cciCubeUtil";

/**
 * Creates a new Cube containing a correctly formed text post.
 * Don't forget to add it to your cubeStore!
 * Don't forget to call Identity.store() on your Identity object afterwards!
 */
export async function makePost(
    text: string,
    replyto?: CubeKey,
    id?: Identity,
    requiredDifficulty = Settings.REQUIRED_DIFFICULTY): Promise<cciCube> {
  const zwFields: cciFields = new cciFields(cciField.Application(("ZW")), cciFrozenFieldDefinition);
  zwFields.appendField(cciField.MediaType(MediaTypes.TEXT));
  zwFields.appendField(cciField.Payload(text));

  if (replyto) {
    zwFields.appendField(cciField.RelatesTo(
      new cciRelationship(cciRelationshipType.REPLY_TO, replyto)
    ));
  }

  if (id) {
    // Add MYPOST references

    // TODO calculate how many post references fit based on actual free size
    // in this Cube.
    // For now, let's just say 10. I think 10 will fit.
    // TODO: use fibonacci spacing for post references instead of linear,
    // but only if there are actually enough posts to justify it
    // TODO: move this logic to Identity (or vice-versa) as Identity does
    // exactly the same stuff when generating a MUC
    for (let i = 0; i < id.posts.length && i < 10; i++) {
      zwFields.appendField(cciField.RelatesTo(
        new cciRelationship(cciRelationshipType.MYPOST, Buffer.from(id.posts[i], 'hex'))
      ));
    }
  }

  const cube: cciCube = cciCube.Frozen({
    fields: zwFields,
    family: cciFamily,
    requiredDifficulty: requiredDifficulty});
  cube.getBinaryData();  // finalize Cube & compile fields

  if (id) {
    // Have the Identity remember this new post
    id.rememberMyPost(await cube.getKey());
  }
  return cube;
}

export function assertZwCube(cube: Cube): boolean {
  if (!(isCci(cube))) {
    logger.trace("assertZwCube: Supplied object is not a CCI Cube");
    return false;
  }
  const fields: cciFields = cube?.fields as cciFields;
  if (!(fields instanceof cciFields)) {
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
