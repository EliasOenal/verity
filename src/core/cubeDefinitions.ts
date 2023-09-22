import { VerityError } from "./config";
import { NetConstants } from "./networkDefinitions";

export const CUBE_HEADER_LENGTH: number = 0;  // Former headers now considered positional fields -- TODO remove this constant

export enum CubeType {
  CUBE_TYPE_REGULAR = 0xFF,
  CUBE_TYPE_MUC = 0x00,
  CUBE_TYPE_IPC = 0x01,
  CUBE_TYPE_RESERVED = 0x02,
  CUBE_TYPE_RESERVED2 = 0x03,
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
