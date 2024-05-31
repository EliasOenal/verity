import { Settings } from "../../core/settings";
import { NetConstants } from "../../core/networking/networkDefinitions";

import { cciRelationship } from "./cciRelationship";

import { FieldError } from "../../core/cube/cubeDefinitions";
import { CubeFieldType, CubeFieldLength, CubeField } from "../../core/cube/cubeField";

import { Buffer } from 'buffer'
import { FieldNumericalParam } from "../../core/fields/fieldParser";

/**
 * cciAdditionalFieldType contains the field types defined on the CCI layer,
 * which supplement the CoreFieldTypes.
 * For three CCI field types -- PAYLAOD, CCI_END and PADDING -- this
 * implementation improperly defines them in the core layer instead, as they
 * are used in core layer unit tests and in padding up "core" Cubes.
 **/
enum cciAdditionalFieldType {
  // CCI_END = 0x00 << 2,    // 0 -- currently defined on core layer
  APPLICATION = 0x01 << 2,   // 4
  CONTINUED_IN = 0x02 << 2,  // 8

  /**
  * Seed used to derive a new key pair for an extension MUC.
  * Note that this should not actually be public information as it's only needed
  * by the author to derive their private key from their master key.
  * We're still putting it right into the MUC out of convenience and due to
  * the fact that this information must be available somewhere on the network
  * for Identity recovery ("password-based login").
  * We're pretty confident this does not actually expose any cryptographically
  * sensitive information, but we maybe should encrypt it.
  */
  SUBKEY_SEED = 0x03 << 2,   // 12

  // PAYLOAD = 0x10 << 2,    // 64 -- currently defined on core layer
  CONTENTNAME = 0x11 << 2,   // 68
  DESCRIPTION = 0x12 << 2,   // 72
  RELATES_TO = 0x13 << 2,    // 76
  USERNAME = 0x14 << 2,      // 80
  MEDIA_TYPE = 0x15 << 2,    // 84
  AVATAR = 0x16 << 2,        // 88
  // PADDING = 0x1F << 2,    // 124 -- currently defined on core layer

  REMAINDER = 40001,         // virtual field only used on decompiling Cubes
                             // to represent data after CCI_END
}
export const cciFieldType = {...CubeFieldType, ...cciAdditionalFieldType} as const;

export const cciAdditionalFieldLength: FieldNumericalParam = {
  [cciFieldType.CONTINUED_IN]: NetConstants.CUBE_KEY_SIZE,
  [cciFieldType.CONTENTNAME]: undefined,
  [cciFieldType.DESCRIPTION]: undefined,
  [cciFieldType.SUBKEY_SEED]: undefined,
  [cciFieldType.AVATAR]: undefined,
  [cciFieldType.APPLICATION]: undefined,
  [cciFieldType.MEDIA_TYPE]: 1,
  [cciFieldType.RELATES_TO]: NetConstants.RELATIONSHIP_TYPE_SIZE + NetConstants.CUBE_KEY_SIZE,
  [cciFieldType.USERNAME]: undefined,
  [cciFieldType.REMAINDER]: undefined,
}
export const cciFieldLength = {...CubeFieldLength, ...cciAdditionalFieldLength};


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
    return new CubeField(cciFieldType.SUBKEY_SEED, buf as Buffer);
  }

  static Application(applicationString: string): cciField {
    const applicationBuf = Buffer.from(applicationString, 'utf-8');
    return new this(
      cciFieldType.APPLICATION, applicationBuf);
  }

  static ContentName(name: string) {
    return new this(cciFieldType.CONTENTNAME, name);
  }

  static Description(desc: string) {
    return new this(cciFieldType.DESCRIPTION, desc);
  }

  static RelatesTo(rel: cciRelationship) {
    const value: Buffer = Buffer.alloc(
        NetConstants.RELATIONSHIP_TYPE_SIZE +
        NetConstants.CUBE_KEY_SIZE);
    value.writeUIntBE(rel.type, 0, NetConstants.RELATIONSHIP_TYPE_SIZE);
    rel.remoteKey.copy(
        value,  // target buffer
        NetConstants.RELATIONSHIP_TYPE_SIZE,  // target start position
        0,  // source start
        NetConstants.CUBE_KEY_SIZE  // source end
    );
    return new this(cciFieldType.RELATES_TO, value);
  }


  static Payload(buf: Buffer | string): cciField  {
    return super.Payload(buf, cciField);
  }

  static MediaType(type: MediaTypes) {
    return new this(cciFieldType.MEDIA_TYPE, Buffer.alloc(1).fill(type));
  }

  static Username(name: string): cciField {
    const buf = Buffer.from(name, 'utf-8');
    return new this(cciFieldType.USERNAME, buf);
  }

  static CciEnd() {
    return new this(cciFieldType.CCI_END, Buffer.alloc(0));
  }

  static *FromRelationships(rels: Iterable<cciRelationship>): Generator<cciField> {
    for (const rel of rels) yield cciField.RelatesTo(rel);
  }

  constructor(type: number, value: Buffer | string, start?: number) {
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
