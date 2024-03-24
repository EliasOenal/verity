import { Settings } from "../../core/settings";
import { NetConstants } from "../../core/networking/networkDefinitions";

import { cciRelationship } from "./cciRelationship";

import { FieldError } from "../../core/cube/cubeDefinitions";
import { CubeFieldType, CubeFieldLength, CubeField } from "../../core/cube/cubeField";

import { Buffer } from 'buffer'

// HACKHACK: For proper layering, this file should define CCI field IDs and
// associated length data. These should extend the base CubeFieldTypes.
// However, TypeScript lacks a proper way to extend enums.
// Therefore, CCI currently uses the core's CubeFieldTypes, which include

// CCI fields even though they don't belong there.
export const cciFieldType = CubeFieldType;
export const cciFieldLength = CubeFieldLength;


export enum MediaTypes {
  TEXT = 1,  // may contain markdown
  JPEG = 2,
  RESERVED = 255,  // may be used for an extension header
}


/**
 * CCI fields represent a common framework for application-level fields.
 * A cciField object represents a single CCI-compliant field in a Cube.
 */
export class cciField extends CubeField {
  static relationshipType = cciRelationship;

  static SubkeySeed(buf: Buffer | Uint8Array): CubeField {
    if (!(buf instanceof Buffer)) buf = Buffer.from(buf);
    return new CubeField(CubeFieldType.SUBKEY_SEED, buf as Buffer);
  }

  static Application(applicationString: string): cciField {
    const applicationBuf = Buffer.from(applicationString, 'utf-8');
    return new cciField(
      cciFieldType.APPLICATION, applicationBuf);
  }

  static RelatesTo(rel: cciRelationship) {
    const value: Buffer = Buffer.alloc(
        NetConstants.RELATIONSHIP_TYPE_SIZE +
        NetConstants.CUBE_KEY_SIZE);
    value.writeIntBE(rel.type, 0, NetConstants.RELATIONSHIP_TYPE_SIZE);
    rel.remoteKey.copy(
        value,  // target buffer
        NetConstants.RELATIONSHIP_TYPE_SIZE,  // target start position
        0,  // source start
        NetConstants.CUBE_KEY_SIZE  // source end
    );
    return new cciField(
      cciFieldType.RELATES_TO, value);
  }


  static Payload(buf: Buffer | string): cciField  {
    return super.Payload(buf, cciField);
  }

  static MediaType(type: MediaTypes) {
    return new cciField(cciFieldType.MEDIA_TYPE, Buffer.alloc(1).fill(type));
  }

  static Username(name: string): cciField {
    const buf = Buffer.from(name, 'utf-8');
    return new cciField(cciFieldType.USERNAME, buf);
  }

  static *FromRelationships(rels: Iterable<cciRelationship>): Generator<cciField> {
    for (const rel of rels) yield cciField.RelatesTo(rel);
  }

  constructor(type: number, value: Buffer, start?: number) {
    // Note: cciFieldLength is currently just an alias for CubeFieldLength,
    // making this check completely redundant. However, we will want to properly
    // separate them at some point, and then it won't be.
    if (Settings.RUNTIME_ASSERTIONS && cciFieldLength[type] !== undefined &&
        value.length !== cciFieldLength[type]) {
      throw new FieldError(`Cannot construct cciField of type ${type} with length ${value.length}, spec prescribes length of ${cciFieldLength[type]}`);
    }
    super(type, value, start);
  }
}