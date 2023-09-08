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

export function makePost(
    text: string,
    replyto?: CubeKey,
    id?: Identity): Cube {
  const zwFields: ZwFields = new ZwFields(ZwField.Application());
  zwFields.data.push(ZwField.MediaType(MediaTypes.TEXT));
  zwFields.data.push(ZwField.Payload(text));

  if (replyto) {
    zwFields.data.push(ZwField.RelatesTo(
      new ZwRelationship(ZwRelationshipType.REPLY_TO, replyto)
    ));
  }

  if (id) {
    // TODO include MYPOSTs
  }

  const zwData: Buffer = new FieldParser(zwFieldDefinition).compileFields(zwFields);
  const cube: Cube = new Cube();
  cube.setFields(CubeField.Payload(zwData));
  cube.getBinaryData();  // finalize Cube & compile fields
  return cube;
}

// maybe provide a makeMUC() function as well?
// on the other hand, there will probably no other code creating MUCs
// besides Identity.makeMUC().
