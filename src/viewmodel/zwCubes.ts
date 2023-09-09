/**
 * Helper functions to create standard "ZW" cubes as used by our micro-blogging
 * application.
 * These are standard cubes, not even Cube subclasses.
 * They just follow a standardized field structure.
 */

import { Cube, CubeKey } from "../model/cube";
import { CubeField } from "../model/cubeFields";
import { FieldParser } from "../model/fieldParser";
import { Identity } from "./identity";
import { MediaTypes, ZwField, ZwFields, ZwRelationship, ZwRelationshipType, zwFieldDefinition } from "./zwFields";

/**
 * Creates a new Cube containing a correctly formed text post.
 * Don't forget to call Identity.store() on your Identity object afterwards!
 */
export async function makePost(
    text: string,
    replyto?: CubeKey,
    id?: Identity): Promise<Cube> {
  const zwFields: ZwFields = new ZwFields(ZwField.Application());
  zwFields.data.push(ZwField.MediaType(MediaTypes.TEXT));
  zwFields.data.push(ZwField.Payload(text));

  if (replyto) {
    zwFields.data.push(ZwField.RelatesTo(
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
      zwFields.data.push(ZwField.RelatesTo(
        new ZwRelationship(ZwRelationshipType.MYPOST, Buffer.from(id.posts[i], 'hex'))
      ));
    }
  }

  const zwData: Buffer = new FieldParser(zwFieldDefinition).compileFields(zwFields);
  const cube: Cube = new Cube();
  cube.setFields(CubeField.Payload(zwData));
  cube.getBinaryData();  // finalize Cube & compile fields

  if (id) {
    // Have the Identity remember this new post
    id.posts.unshift((await cube.getKey()).toString('hex'));
  }
  return cube;
}

// maybe provide a makeMUC() function as well?
// on the other hand, there will probably no other code creating MUCs
// besides Identity.makeMUC().
