import { VerityError } from "./config";
import { NetConstants } from "./networkDefinitions";

// TODO document: provide details on what these 6 bytes are
export const CUBE_HEADER_LENGTH: number = 6;

export enum CubeType {
  CUBE_TYPE_REGULAR = 0xFF,
  CUBE_TYPE_MUC = 0x00,
  CUBE_TYPE_IPC = 0x01,
  CUBE_TYPE_RESERVED = 0x02,
  CUBE_TYPE_RESERVED2 = 0x03,
}

/**
 * Top-level field definitions.
 * These are used for the FieldParser in the core library.
 * Applications will usually supplement this with their own sub-field structure
 * within the top-level payload field; for this, they can re-use our FieldParser
 * by supplying it with their own field structure data.
 */
export enum FieldType {
  PADDING_NONCE = 0x00 << 2,
  PAYLOAD = 0x01 << 2,
  RELATES_TO = 0x02 << 2,
  KEY_DISTRIBUTION = 0x03 << 2,
  SHARED_KEY = 0x04 << 2,
  ENCRYPTED = 0x05 << 2,
  TYPE_SIGNATURE = 0x06 << 2,
  TYPE_SMART_CUBE = 0x07 << 2,
  TYPE_PUBLIC_KEY = 0x08 << 2,
}

export const FIELD_LENGTHS: { [key: number]: number | undefined } = {
  [FieldType.PAYLOAD]: undefined,
  [FieldType.RELATES_TO]: NetConstants.RELATIONSHIP_TYPE_SIZE + NetConstants.CUBE_KEY_SIZE,
  [FieldType.PADDING_NONCE]: undefined,
  [FieldType.KEY_DISTRIBUTION]: 40,
  [FieldType.SHARED_KEY]: 32,
  [FieldType.ENCRYPTED]: undefined,
  [FieldType.TYPE_SIGNATURE]: 72,
  [FieldType.TYPE_SMART_CUBE]: 0, // Just a single header byte
  [FieldType.TYPE_PUBLIC_KEY]: 32,
};

export enum RelationshipType {
  CONTINUED_IN = 1,
  MENTION = 2,
  REPLY_TO = 3,
  QUOTATION = 4,
  OWNS = 5,
}


// Error definitions
export class CubeError extends VerityError { }
export class CubeApiUsageError extends CubeError { }
export class InsufficientDifficulty extends CubeError { }
export class InvalidCubeKey extends CubeError { }

export class FieldError extends CubeError { }
export class FieldSizeError extends CubeError { }
export class UnknownFieldType extends FieldError { }
export class FieldNotImplemented extends FieldError { }
export class CubeRelationshipError extends FieldError { }
export class WrongFieldType extends FieldError { }

export class BinaryDataError extends CubeError { }
export class BinaryLengthError extends BinaryDataError { }

export class SmartCubeError extends CubeError { }
export class FingerprintError extends SmartCubeError { }
export class CubeSignatureError extends SmartCubeError { }

export class SmartCubeTypeNotImplemented extends SmartCubeError { }
