/**
 * Helper functions to create standard "ZW" cubes as used by our micro-blogging
 * application.
 * These are standard cubes, not even Cube subclasses.
 * They just follow a standardized field structure.
 */

import { BaseField } from "../core/cube/baseFields";
import { Settings } from "../core/settings";
import { Cube } from "../core/cube/cube";
import { CubeError, CubeKey, CubeType } from "../core/cube/cubeDefinitions";
import { CubeField } from "../core/cube/cubeFields";
import { FieldParser } from "../core/fieldParser";
import { Identity } from "../cci/identity";
import { MediaTypes, cciField, cciFieldType, cciFields, cciRelationship, cciRelationshipType, cciDumbFieldDefinition, cciFieldParsers } from "../cci/cciFields";

import { Buffer } from 'buffer';
import { cciCube } from "../cci/cciCube";
import { logger } from "../core/logger";

/**
 * Creates a new Cube containing a correctly formed text post.
 * Don't forget to call Identity.store() on your Identity object afterwards!
 */
export async function makePost(
    text: string,
    replyto?: CubeKey,
    id?: Identity,
    required_difficulty = Settings.REQUIRED_DIFFICULTY): Promise<cciCube> {
  const zwFields: cciFields = new cciFields(cciField.Application(("ZW")), cciDumbFieldDefinition);
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

  const cube: cciCube = cciCube.Dumb(zwFields, cciFieldParsers, required_difficulty);
  cube.getBinaryData();  // finalize Cube & compile fields

  if (id) {
    // Have the Identity remember this new post
    id.rememberMyPost(await cube.getKey());
  }
  return cube;
}

export function assertZwCube(cube: Cube): boolean {
  const fields: cciFields = cube?.fields as cciFields;
  if (!(fields instanceof cciFields)) {
    logger.trace("assertZwCube: Supplied object is not a Cube, does not contain CCI fields or was not re-instantiated in a way that exposes CCI fields");
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
