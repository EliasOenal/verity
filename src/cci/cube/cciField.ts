import { Settings } from "../../core/settings";
import { NetConstants } from "../../core/networking/networkDefinitions";

import { FieldError } from "../../core/cube/cube.definitions";
import { CubeField } from "../../core/cube/cubeField";

import { cciFieldType, MediaTypes, cciFieldLength } from "./cciCube.definitions";
import { cciRelationship } from "./cciRelationship";

import { Buffer } from 'buffer'

/**
 * CCI fields represent a common framework for application-level fields.
 * A cciField object represents a single CCI-compliant field in a Cube.
 */
export class cciField extends CubeField {
  // line below causes issues due to circular dependency
  // static relationshipType = cciRelationship;

  static CciEnd() {
    return new this(cciFieldType.CCI_END, Buffer.alloc(0));
  }

  static Application(applicationString: string): cciField {
    const applicationBuf = Buffer.from(applicationString, 'utf-8');
    return new this(
      cciFieldType.APPLICATION, applicationBuf);
  }

  static Encrypted(encrypted: Buffer): cciField {
    return new this(cciFieldType.ENCRYPTED, encrypted);
  }

  static CryptoNonce(nonce: Buffer): cciField {
    if (Settings.RUNTIME_ASSERTIONS && nonce.length !== NetConstants.CRYPTO_NONCE_SIZE) {
      throw new FieldError(`Supplied nonce size of ${nonce.length} does not match NetConstants.CRYPTO_NONCE_SIZE === ${NetConstants.CRYPTO_NONCE_SIZE}.`);
    }
    return new this(cciFieldType.CRYPTO_NONCE, nonce);
  }

  static CryptoMac(mac: Buffer): cciField {
    return new this(cciFieldType.CRYPTO_MAC, mac);
  }

  static CryptoKey(encryptedKey: Buffer): cciField {
    return new this(cciFieldType.CRYPTO_KEY, encryptedKey);
  }

  static CryptoPubkey(pubkey: Buffer): cciField {
    return new this(cciFieldType.CRYPTO_PUBKEY, pubkey);
  }

  static SubkeySeed(buf: Buffer | Uint8Array): CubeField {
    if (!(buf instanceof Buffer)) buf = Buffer.from(buf);
    return new CubeField(cciFieldType.SUBKEY_SEED, buf as Buffer);
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


  static Payload(buf: Buffer | string) {
    if (typeof buf === 'string' || buf instanceof String)  {
        buf = Buffer.from(buf, 'utf-8');
    }
    return new this(cciFieldType.PAYLOAD, buf);
  }

  static MediaType(type: MediaTypes) {
    return new this(cciFieldType.MEDIA_TYPE, Buffer.alloc(1).fill(type));
  }

  static Username(name: string): cciField {
    const buf = Buffer.from(name, 'utf-8');
    return new this(cciFieldType.USERNAME, buf);
  }

  static *FromRelationships(rels: Iterable<cciRelationship>): Generator<cciField> {
    for (const rel of rels) yield cciField.RelatesTo(rel);
  }

  /**
   * Will return a PADDING field if requested length is > 1 or the special
   * PADDING_SINGLEBYTE field for the length==1 edge case.
  */
  static Padding(length: number): cciField {
    let field: cciField;
    if (length > 1) {
      const random_bytes = new Uint8Array(length-2);
      for (let i = 0; i < length - 2; i++) {  // maybe TODO: 2 is the header length of a variable size field and we should usually get this value from the field parser rather than littering literals throughout the code
        random_bytes[i] = Math.floor(Math.random() * 256);
      }
      field = new this(cciFieldType.PADDING, Buffer.from(random_bytes));
    } else {
      field = new this(cciFieldType.CCI_END, Buffer.alloc(0));
    }
    return field;
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
