import { VerityError } from "../settings";

import { Buffer } from 'buffer'

export const CUBE_HEADER_LENGTH: number = 0;  // Former headers now considered positional fields -- TODO remove this constant

export enum CubeType {
  DUMB = 0xFF,
  MUC = 0,
  PIC = 1,
}

// semantic typedef
// TAKE CARE! TRAP! TYPESCRIPT IS CRAP! (that rhymes)
// Never check if something is instanceof CubeKey, it never will be.
// All the underlying lib will ever give us are Buffers, and Typescript will
// gladly allow you to treat a Buffer as CubeKey without correctly downcasting it :(
export class CubeKey extends Buffer {}

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
