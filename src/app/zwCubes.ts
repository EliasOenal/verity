/**
 * Helper functions to create standard "ZW" cubes as used by our micro-blogging
 * application.
 * These are standard cubes, not even Cube subclasses.
 * They just follow a standardized field structure.
 */

import { BaseField } from "../core/baseFields";
import { Settings } from "../core/config";
import { Cube, CubeKey } from "../core/cube";
import { CubeError, CubeType } from "../core/cubeDefinitions";
import { CubeField } from "../core/cubeFields";
import { FieldParser } from "../core/fieldParser";
import { Identity } from "./identity";
import { MediaTypes, ZwField, ZwFieldType, ZwFields, ZwRelationship, ZwRelationshipType, zwFieldDefinition } from "./zwFields";

import { Buffer } from 'buffer';

/**
 * Creates a new Cube containing a correctly formed text post.
 * Don't forget to call Identity.store() on your Identity object afterwards!
 */
export async function makePost(
    text: string,
    replyto?: CubeKey,
    id?: Identity,
    required_difficulty = Settings.REQUIRED_DIFFICULTY): Promise<Cube> {
  const zwFields: ZwFields = new ZwFields(ZwField.Application());
  zwFields.appendField(ZwField.MediaType(MediaTypes.TEXT));
  zwFields.appendField(ZwField.Payload(text));

  if (replyto) {
    zwFields.appendField(ZwField.RelatesTo(
      new ZwRelationship(ZwRelationshipType.REPLY_TO, replyto)
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
      zwFields.appendField(ZwField.RelatesTo(
        new ZwRelationship(ZwRelationshipType.MYPOST, Buffer.from(id.posts[i], 'hex'))
      ));
    }
  }

  const zwData: Buffer = new FieldParser(zwFieldDefinition).compileFields(zwFields);
  const cube: Cube = new Cube(undefined, required_difficulty);
  cube.setFields(CubeField.Payload(zwData));
  cube.getBinaryData();  // finalize Cube & compile fields

  if (id) {
    // Have the Identity remember this new post
    id.rememberMyPost(await cube.getKey());
  }
  return cube;
}

// TODO remove, unnecessary
export function assertZwCube(cube: Cube): ZwFields {
  const zwFields: ZwFields = ZwFields.get(cube);
  if (!zwFields) {
    throw new CubeError("Supplied cube is not a ZW cube, lacks ZW fields");
  }
  return zwFields;
}

export function assertZwMuc(cube: Cube): ZwFields {
  if (cube.cubeType != CubeType.CUBE_TYPE_MUC) {
    throw new CubeError("Supplied Cube is not a ZW Muc, as it's not a MUC at all.");
  }
  else return assertZwCube(cube);
}

// maybe provide a makeMUC() function as well?
// on the other hand, there will probably no other code creating MUCs
// besides Identity.makeMUC().
