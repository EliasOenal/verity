import { Settings } from "../../core/settings";
import { NetConstants } from "../../core/networking/networkDefinitions";

import { FieldError } from "../../core/cube/cube.definitions";
import { CubeField } from "../../core/cube/cubeField";

import { FieldType, MediaTypes, FieldLength } from "./cciCube.definitions";
import { cciRelationship } from "./cciRelationship";

import { Buffer } from 'buffer'

/**
 * CCI fields represent a common framework for application-level fields.
 * A cciField object represents a single CCI-compliant field in a Cube.
 */
export class VerityField extends CubeField {
  // line below causes issues due to circular dependency
  // static relationshipType = cciRelationship;

  static CciEnd() {
    return new this(FieldType.CCI_END, Buffer.alloc(0));
  }

  static Application(applicationString: string): VerityField {
    const applicationBuf = Buffer.from(applicationString, 'utf-8');
    return new this(
      FieldType.APPLICATION, applicationBuf);
  }

  static Encrypted(encrypted: Buffer): VerityField {
    return new this(FieldType.ENCRYPTED, encrypted);
  }

  static CryptoPubkey(pubkey: Buffer): VerityField {
    return new this(FieldType.CRYPTO_PUBKEY, pubkey);
  }

  static SubkeySeed(buf: Buffer | Uint8Array): CubeField {
    if (!(buf instanceof Buffer)) buf = Buffer.from(buf);
    return new CubeField(FieldType.SUBKEY_SEED, buf as Buffer);
  }

  static ContentName(name: string) {
    return new this(FieldType.CONTENTNAME, name);
  }

  static Description(desc: string) {
    return new this(FieldType.DESCRIPTION, desc);
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
    return new this(FieldType.RELATES_TO, value);
  }


  static Payload(buf: Buffer | string) {
    if (typeof buf === 'string' || buf instanceof String)  {
        buf = Buffer.from(buf, 'utf-8');
    }
    return new this(FieldType.PAYLOAD, buf);
  }

  static MediaType(type: MediaTypes) {
    return new this(FieldType.MEDIA_TYPE, Buffer.alloc(1).fill(type));
  }

  static Username(name: string): VerityField {
    const buf = Buffer.from(name, 'utf-8');
    return new this(FieldType.USERNAME, buf);
  }

  static *FromRelationships(rels: Iterable<cciRelationship>): Generator<VerityField> {
    for (const rel of rels) yield VerityField.RelatesTo(rel);
  }

  /**
   * Will return a PADDING field if requested length is > 1 or the special
   * PADDING_SINGLEBYTE field for the length==1 edge case.
  */
  static Padding(length: number): VerityField {
    let field: VerityField;
    if (length > 1) {
      const random_bytes = new Uint8Array(length-2);
      for (let i = 0; i < length - 2; i++) {  // maybe TODO: 2 is the header length of a variable size field and we should usually get this value from the field parser rather than littering literals throughout the code
        random_bytes[i] = Math.floor(Math.random() * 256);
      }
      field = new this(FieldType.PADDING, Buffer.from(random_bytes));
    } else {
      field = new this(FieldType.CCI_END, Buffer.alloc(0));
    }
    return field;
  }


  constructor(type: number, value: Buffer | string, start?: number) {
    // Note: cciFieldLength is currently just an alias for CubeFieldLength,
    // making this check completely redundant. However, we will want to properly
    // separate them at some point, and then it won't be.
    if (Settings.RUNTIME_ASSERTIONS && FieldLength[type] !== undefined &&
        value.length !== FieldLength[type]) {
      throw new FieldError(`Cannot construct cciField of type ${type} with length ${value.length}, spec prescribes length of ${FieldLength[type]}`);
    }
    super(type, value, start);
  }

  toString(valEnc: BufferEncoding = 'hex'): string {
    if (this.type === FieldType.RELATES_TO) {
      return "cciField representing " + cciRelationship.fromField(this).toString();
    }
    return `${FieldType[this.type] ?? this.type} cciField, value ${this.value.toString(valEnc)}`
  }
}
