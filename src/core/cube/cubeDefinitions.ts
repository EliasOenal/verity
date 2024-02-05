import { Settings, VerityError } from "../settings";

import { Buffer } from 'buffer'

export enum CubeType {
  DUMB = (Settings.CUBE_VERSION << 4) + (0 << 2),
  PIC = (Settings.CUBE_VERSION << 4) + (1 << 2),  // not fully implemented yet
  MUC = (Settings.CUBE_VERSION << 4) + (2 << 2),
  // PMUC = (Settings.CUBE_VERISION << 4) + (3 << 2), not implemented yet
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
export class MissingFieldError extends FieldError { }
export class FieldContentError extends FieldError { }
export class FieldSizeError extends FieldError { }
export class UnknownFieldType extends FieldError { }
export class FieldNotImplemented extends FieldError { }
export class CubeRelationshipError extends FieldError { }
export class WrongFieldType extends FieldError { }

export class BinaryDataError extends CubeError { }
export class BinaryLengthError extends BinaryDataError { }

export class SmartCubeError extends CubeError { }
export class CubeSignatureError extends SmartCubeError { }

export class SmartCubeTypeNotImplemented extends SmartCubeError { }
