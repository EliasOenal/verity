import { Settings } from "../../core/settings";
import { NetConstants } from "../../core/networking/networkDefinitions";

import { CubeKey, FieldError } from "../../core/cube/cube.definitions";
import { CubeField } from "../../core/cube/cubeField";

import { FieldType, MediaTypes, FieldLength } from "./cciCube.definitions";
import { Relationship, RelationshipType } from "./relationship";

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

  static RelatesTo(rel: Relationship): VerityField;
  static RelatesTo(type: RelationshipType, remoteKey: CubeKey);
  static RelatesTo(input1: Relationship | RelationshipType, input2?: CubeKey): VerityField {
    // normalise input
    let rel: Relationship;
    if (input1 instanceof Relationship) rel = input1;
    else rel = new Relationship(input1, input2);

    // craft field
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

  static *FromRelationships(rels: Iterable<Relationship>): Generator<VerityField> {
    for (const rel of rels) yield VerityField.RelatesTo(rel);
  }

  /**
   * Will return a PADDING field if requested length is > 1 or the special
   * PADDING_SINGLEBYTE field for the length==1 edge case.
  */
  static Padding(length: number, random: boolean = false): VerityField {
    let field: VerityField;
    if (length > 1) {
      const padding_bytes = Buffer.alloc(length-2, 0);
      if (random) {
        for (let i = 0; i < length - 2; i++) {  // maybe TODO: 2 is the header length of a variable size field and we should usually get this value from the field parser rather than littering literals throughout the code
          padding_bytes[i] = Math.floor(Math.random() * 256);
        }
      }
      field = new this(FieldType.PADDING, padding_bytes);
    } else {
      field = new this(FieldType.CCI_END, Buffer.alloc(0));
    }
    return field;
  }


  constructor(type: number, value: Buffer | string | String, start?: number);
  constructor(copyFrom: VerityField);
  constructor(param1: number|VerityField, value?: Buffer | string, start?: number);
  constructor(param1: number|CubeField, value?: Buffer | string, start?: number) {
    // Note: This currently runs the check twice, once here and once at the
    //   core Cube field level. This is unneccessary, but it's not an expensive check either.
    if (Settings.RUNTIME_ASSERTIONS && typeof param1 === 'number' && FieldLength[param1] !== undefined &&
        value.length !== FieldLength[param1]) {
      throw new FieldError(`Cannot construct VerityField of type ${param1} with length ${value.length}, spec prescribes length of ${FieldLength[param1]}`);
    }
    super(param1, value, start);
  }

  toString(valEnc: BufferEncoding = 'hex'): string {
    if (this.type === FieldType.RELATES_TO) {
      return "cciField representing " + Relationship.fromField(this).toString();
    }
    return `${FieldType[this.type] ?? this.type} cciField, value ${this.value.toString(valEnc)}`
  }
}
