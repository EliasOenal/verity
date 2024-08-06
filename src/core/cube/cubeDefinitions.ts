import { Settings, VerityError } from "../settings";

import { Buffer } from 'buffer';

export enum CubeType {
  FROZEN = (Settings.CUBE_VERSION << 4) + (0 << 2),
  FROZEN_NOTIFY = (Settings.CUBE_VERSION << 4) + (0 << 2) + (1 << 0) ,
  PIC = (Settings.CUBE_VERSION << 4) + (1 << 2),                    // not fully implemented yet
  PIC_NOTIFY = (Settings.CUBE_VERSION << 4) + (1 << 2) + (1 << 0),  // not fully implemented yet
  MUC = (Settings.CUBE_VERSION << 4) + (2 << 2),
  MUC_NOTIFY = (Settings.CUBE_VERSION << 4) + (2 << 2) + (1 << 0),
  PMUC = (Settings.CUBE_VERSION << 4) + (3 << 2),                   // not implemented yet
  PMUC_NOTIFY = (Settings.CUBE_VERSION << 4) + (3 << 2) + (1 << 0)  // not implemented yet
}

// semantic typedef
// TAKE CARE! TRAP! TYPESCRIPT IS CRAP! (that rhymes)
// Never check if something is instanceof CubeKey, it never will be.
// All the underlying lib will ever give us are Buffers, and Typescript will
// gladly allow you to treat a Buffer as CubeKey without correctly downcasting it :(
export class CubeKey extends Buffer {}

// Error definitions
export class CubeError extends VerityError { name = "CubeError" }
export class CubeApiUsageError extends CubeError { name = "CubeApiUsageError" }
export class InsufficientDifficulty extends CubeError { name = "InsufficientDifficulty" }
export class InvalidCubeKey extends CubeError { name = "InvalidCubeKey" }

export class FieldError extends CubeError { name = "FieldError" }
export class MissingFieldError extends FieldError { name = "MissingFieldError" }
export class FieldContentError extends FieldError { name = "FieldContentError" }
export class FieldSizeError extends FieldError { name = "FieldSizeError" }
export class UnknownFieldType extends FieldError { name = "UnknownFieldType" }
export class FieldNotImplemented extends FieldError { name = "FieldNotImplemented" }
export class CubeRelationshipError extends FieldError { name = "CubeRelationshipError" }
export class WrongFieldType extends FieldError { name = "WrongFieldType" }

export class BinaryDataError extends CubeError { name = "BinaryDataError" }
export class BinaryLengthError extends BinaryDataError { name = "BinaryLengthError" }
export class SmartCubeError extends CubeError { name = "SmartCubeError" }

export class CubeSignatureError extends SmartCubeError { name = "CubeSignatureError" }
export class SmartCubeTypeNotImplemented extends SmartCubeError { name = "SmartCubeTypeNotImplemented" }
