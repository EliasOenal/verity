import { Settings, VerityError } from "../settings";
import { NetConstants } from "../networking/networkDefinitions";
import type { FieldBooleanParam, FieldFactoryParam, FieldNumericalParam, PositionalFields } from "../fields/fieldParser";

import { Buffer } from 'buffer';
import { CubeField } from "./cubeField";

// Note: To avoid circular references, this file should not include any of the
// actual implementation files under cube.

/** All available Cube types */
export enum CubeType {
  FROZEN = (Settings.CUBE_VERSION << 4) + (0 << 2),                    // 16
  FROZEN_NOTIFY = (Settings.CUBE_VERSION << 4) + (0 << 2) + (1 << 0),  // 17
  PIC = (Settings.CUBE_VERSION << 4) + (1 << 2),                       // 20
  PIC_NOTIFY = (Settings.CUBE_VERSION << 4) + (1 << 2) + (1 << 0),     // 21
  MUC = (Settings.CUBE_VERSION << 4) + (2 << 2),                       // 24
  MUC_NOTIFY = (Settings.CUBE_VERSION << 4) + (2 << 2) + (1 << 0),     // 25
  PMUC = (Settings.CUBE_VERSION << 4) + (3 << 2),                      // 28
  PMUC_NOTIFY = (Settings.CUBE_VERSION << 4) + (3 << 2) + (1 << 0)     // 29
}

/**
 * Core field definitions.
 * These are used for the FieldParser in the core library.
 * Applications will usually supplement this with their own sub-field structure;
 * our CCI layer provides an optional framework for doing this.
 */
export enum CubeFieldType {
  // Positional fields, listed in order of appearance for ease of reference.
  // Includes all positional fields for all cube types; obviously, different
  // types of cubes will use and omit different fields.
  // Assigned ID is for local purposes only as these are positionals, not TLV.
  TYPE = 1001,
  NOTIFY = 2001,
  PMUC_UPDATE_COUNT = 2002, // not fully implemented yet
  PUBLIC_KEY = 2003,
  DATE = 2004,
  SIGNATURE = 2005,
  NONCE = 2006,

  // fields exposing the full raw payload of the Cube at the core layer:
  FROZEN_RAWCONTENT = 2101,
  FROZEN_NOTIFY_RAWCONTENT = 2102,
  PIC_RAWCONTENT = 2103,
  PIC_NOTIFY_RAWCONTENT = 2104,
  MUC_RAWCONTENT = 2105,
  MUC_NOTIFY_RAWCONTENT = 2106,
  PMUC_RAWCONTENT = 2107,
  PMUC_NOTIFY_RAWCONTENT = 2108,
}

export const CubeFieldLength: FieldNumericalParam = {
  [CubeFieldType.TYPE]: NetConstants.CUBE_TYPE_SIZE,
  [CubeFieldType.NOTIFY]: NetConstants.NOTIFY_SIZE,
  [CubeFieldType.PMUC_UPDATE_COUNT]: NetConstants.PMUC_UPDATE_COUNT_SIZE,
  [CubeFieldType.PUBLIC_KEY]: NetConstants.PUBLIC_KEY_SIZE,
  [CubeFieldType.DATE]: NetConstants.TIMESTAMP_SIZE,
  [CubeFieldType.SIGNATURE]: NetConstants.SIGNATURE_SIZE,
  [CubeFieldType.NONCE]: NetConstants.NONCE_SIZE,
  // Fields exposing the raw content of the Cube at the core layer --
  // these are usually only used in the core layer and not exposed to the
  // application, in particular they are not used within CCI.
  [CubeFieldType.FROZEN_RAWCONTENT]: NetConstants.CUBE_SIZE - NetConstants.CUBE_TYPE_SIZE - NetConstants.TIMESTAMP_SIZE - NetConstants.NONCE_SIZE,
  [CubeFieldType.FROZEN_NOTIFY_RAWCONTENT]: NetConstants.CUBE_SIZE - NetConstants.CUBE_TYPE_SIZE - NetConstants.NOTIFY_SIZE - NetConstants.TIMESTAMP_SIZE - NetConstants.NONCE_SIZE,
  [CubeFieldType.PIC_RAWCONTENT]: NetConstants.CUBE_SIZE - NetConstants.CUBE_TYPE_SIZE - NetConstants.TIMESTAMP_SIZE - NetConstants.NONCE_SIZE,
  [CubeFieldType.PIC_NOTIFY_RAWCONTENT]: NetConstants.CUBE_SIZE - NetConstants.CUBE_TYPE_SIZE - NetConstants.NOTIFY_SIZE - NetConstants.TIMESTAMP_SIZE - NetConstants.NONCE_SIZE,
  [CubeFieldType.MUC_RAWCONTENT]: NetConstants.CUBE_SIZE - NetConstants.CUBE_TYPE_SIZE - NetConstants.PUBLIC_KEY_SIZE - NetConstants.TIMESTAMP_SIZE - NetConstants.SIGNATURE_SIZE - NetConstants.NONCE_SIZE,
  [CubeFieldType.MUC_NOTIFY_RAWCONTENT]: NetConstants.CUBE_SIZE - NetConstants.CUBE_TYPE_SIZE - NetConstants.NOTIFY_SIZE - NetConstants.PUBLIC_KEY_SIZE - NetConstants.TIMESTAMP_SIZE - NetConstants.SIGNATURE_SIZE - NetConstants.NONCE_SIZE,
  [CubeFieldType.PMUC_RAWCONTENT]: NetConstants.CUBE_SIZE - NetConstants.CUBE_TYPE_SIZE - NetConstants.PMUC_UPDATE_COUNT_SIZE - NetConstants.PUBLIC_KEY_SIZE - NetConstants.TIMESTAMP_SIZE - NetConstants.SIGNATURE_SIZE - NetConstants.NONCE_SIZE,
  [CubeFieldType.PMUC_NOTIFY_RAWCONTENT]: NetConstants.CUBE_SIZE - NetConstants.CUBE_TYPE_SIZE - NetConstants.NOTIFY_SIZE - NetConstants.PMUC_UPDATE_COUNT_SIZE - NetConstants.PUBLIC_KEY_SIZE - NetConstants.TIMESTAMP_SIZE - NetConstants.SIGNATURE_SIZE - NetConstants.NONCE_SIZE,
};

//===
// Positional field definitions
//===
// For positional fields, defines the running order this field must be at.
// It follows that positional fields are both mandatory and can only occur once.
// This section defines the positional fields for our four cube types.
// Note: The current implementation requires positional fields to be at the very
// beginning.
// Note: In the current implementation, positional fields MUST have a defined length.
// Note: Numbering starts at 1 (not 0).


// Positional field definitions for frozen Cubes
export const FrozenPositionalFront: PositionalFields = {
  1: CubeFieldType.TYPE,
};
// Core-only version exposing the raw content of the Cube as a single field
export const FrozenCorePositionalFront: PositionalFields = {
  1: CubeFieldType.TYPE,
  2: CubeFieldType.FROZEN_RAWCONTENT,
};
export const FrozenNotifyCorePositionalFront: PositionalFields = {
  1: CubeFieldType.TYPE,
  2: CubeFieldType.FROZEN_NOTIFY_RAWCONTENT,
};
export const FrozenPositionalBack: PositionalFields = {
  1: CubeFieldType.NONCE,
  2: CubeFieldType.DATE,
}
export const FrozenNotifyPositionalBack: PositionalFields = {
  1: CubeFieldType.NONCE,
  2: CubeFieldType.DATE,
  3: CubeFieldType.NOTIFY,
};

// Positional field definitions for PICs
export const PicPositionalFront: PositionalFields = {
  1: CubeFieldType.TYPE,
};
// Core-only version exposing the raw content of the Cube as a single field
export const PicCorePositionalFront: PositionalFields = {
  1: CubeFieldType.TYPE,
  2: CubeFieldType.PIC_RAWCONTENT,
};
export const PicNotifyCorePositionalFront: PositionalFields = {
  1: CubeFieldType.TYPE,
  2: CubeFieldType.PIC_NOTIFY_RAWCONTENT,
};
export const PicPositionalBack: PositionalFields = {
  1: CubeFieldType.NONCE,
  2: CubeFieldType.DATE,
};
export const PicNotifyPositionalBack: PositionalFields = {
  1: CubeFieldType.NONCE,
  2: CubeFieldType.DATE,
  3: CubeFieldType.NOTIFY,
};

// Positional field definitions for MUCs
export const MucPositionalFront: PositionalFields = {
  1: CubeFieldType.TYPE,
};
// Core-only version exposing the raw content of the Cube as a single field
export const MucCorePositionalFront: PositionalFields = {
  1: CubeFieldType.TYPE,
  2: CubeFieldType.MUC_RAWCONTENT,
};
export const MucNotifyCorePositionalFront: PositionalFields = {
  1: CubeFieldType.TYPE,
  2: CubeFieldType.MUC_NOTIFY_RAWCONTENT,
};
export const MucPositionalBack: PositionalFields = {
  1: CubeFieldType.NONCE,
  2: CubeFieldType.SIGNATURE,
  3: CubeFieldType.DATE,
  4: CubeFieldType.PUBLIC_KEY,
};
export const MucNotifyPositionalBack: PositionalFields = {
  1: CubeFieldType.NONCE,
  2: CubeFieldType.SIGNATURE,
  3: CubeFieldType.DATE,
  4: CubeFieldType.PUBLIC_KEY,
  5: CubeFieldType.NOTIFY,
};

// Positional field definitions for PMUCs
export const PmucPositionalFront: PositionalFields = {
  1: CubeFieldType.TYPE,
};
// Core-only version exposing the raw content of the Cube as a single field
export const PmucCorePositionalFront: PositionalFields = {
  1: CubeFieldType.TYPE,
  2: CubeFieldType.PMUC_RAWCONTENT,
};
export const PmucNotifyCorePositionalFront: PositionalFields = {
  1: CubeFieldType.TYPE,
  2: CubeFieldType.PMUC_NOTIFY_RAWCONTENT,
};
export const PmucPositionalBack: PositionalFields = {
  1: CubeFieldType.NONCE,
  2: CubeFieldType.SIGNATURE,
  3: CubeFieldType.DATE,
  4: CubeFieldType.PUBLIC_KEY,
  5: CubeFieldType.PMUC_UPDATE_COUNT,
};
export const PmucNotifyPositionalBack: PositionalFields = {
  1: CubeFieldType.NONCE,
  2: CubeFieldType.SIGNATURE,
  3: CubeFieldType.DATE,
  4: CubeFieldType.PUBLIC_KEY,
  5: CubeFieldType.PMUC_UPDATE_COUNT,
  6: CubeFieldType.NOTIFY,
};

// Default field defitions for frozen Cubes
export const FrozenDefaultFields: FieldFactoryParam = {
  [CubeFieldType.TYPE]: () => CubeField.Type(CubeType.FROZEN),
  [CubeFieldType.FROZEN_RAWCONTENT]: () => CubeField.RawContent(CubeType.FROZEN),
  [CubeFieldType.DATE]: () => CubeField.Date(),
  [CubeFieldType.NONCE]: () => CubeField.Nonce(),
};
export const FrozenNotifyDefaultFields: FieldFactoryParam = {
  [CubeFieldType.TYPE]: () => CubeField.Type(CubeType.FROZEN_NOTIFY),
  [CubeFieldType.FROZEN_NOTIFY_RAWCONTENT]: () => CubeField.RawContent(CubeType.FROZEN_NOTIFY),
  [CubeFieldType.NOTIFY]: () => CubeField.Notify(),
  [CubeFieldType.DATE]: () => CubeField.Date(),
  [CubeFieldType.NONCE]: () => CubeField.Nonce(),
};
export const PicDefaultFields: FieldFactoryParam = {
  [CubeFieldType.TYPE]: () => CubeField.Type(CubeType.PIC),
  [CubeFieldType.PIC_RAWCONTENT]: () => CubeField.RawContent(CubeType.PIC),
  [CubeFieldType.DATE]: () => CubeField.Date(),
  [CubeFieldType.NONCE]: () => CubeField.Nonce(),
};
export const PicNotifyDefaultFields: FieldFactoryParam = {
  [CubeFieldType.TYPE]: () => CubeField.Type(CubeType.PIC_NOTIFY),
  [CubeFieldType.PIC_NOTIFY_RAWCONTENT]: () => CubeField.RawContent(CubeType.PIC_NOTIFY),
  [CubeFieldType.NOTIFY]: () => CubeField.Notify(),
  [CubeFieldType.DATE]: () => CubeField.Date(),
  [CubeFieldType.NONCE]: () => CubeField.Nonce(),
};
export const MucDefaultFields: FieldFactoryParam = {
  [CubeFieldType.TYPE]: () => CubeField.Type(CubeType.MUC),
  [CubeFieldType.MUC_RAWCONTENT]: () => CubeField.RawContent(CubeType.MUC),
  [CubeFieldType.NONCE]: () => CubeField.Nonce(),
  [CubeFieldType.SIGNATURE]: () => CubeField.Signature(),
  [CubeFieldType.DATE]: () => CubeField.Date(),
  [CubeFieldType.PUBLIC_KEY]: () => CubeField.PublicKey(),
};
export const MucNotifyDefaultFields: FieldFactoryParam = {
  [CubeFieldType.TYPE]: () => CubeField.Type(CubeType.MUC_NOTIFY),
  [CubeFieldType.MUC_NOTIFY_RAWCONTENT]: () => CubeField.RawContent(CubeType.MUC_NOTIFY),
  [CubeFieldType.NOTIFY]: () => CubeField.Notify(),
  [CubeFieldType.NONCE]: () => CubeField.Nonce(),
  [CubeFieldType.SIGNATURE]: () => CubeField.Signature(),
  [CubeFieldType.DATE]: () => CubeField.Date(),
  [CubeFieldType.PUBLIC_KEY]: () => CubeField.PublicKey(),
};
export const PmucDefaultFields: FieldFactoryParam = {
  [CubeFieldType.TYPE]: () => CubeField.Type(CubeType.PMUC),
  [CubeFieldType.PMUC_RAWCONTENT]: () => CubeField.RawContent(CubeType.PMUC),
  [CubeFieldType.NONCE]: () => CubeField.Nonce(),
  [CubeFieldType.SIGNATURE]: () => CubeField.Signature(),
  [CubeFieldType.DATE]: () => CubeField.Date(),
  [CubeFieldType.PUBLIC_KEY]: () => CubeField.PublicKey(),
  [CubeFieldType.PMUC_UPDATE_COUNT]: () => CubeField.PmucUpdateCount(),
};
export const PmucNotifyDefaultFields: FieldFactoryParam = {
  [CubeFieldType.TYPE]: () => CubeField.Type(CubeType.PMUC_NOTIFY),
  [CubeFieldType.PMUC_NOTIFY_RAWCONTENT]: () => CubeField.RawContent(CubeType.PMUC_NOTIFY),
  [CubeFieldType.NOTIFY]: () => CubeField.Notify(),
  [CubeFieldType.NONCE]: () => CubeField.Nonce(),
  [CubeFieldType.SIGNATURE]: () => CubeField.Signature(),
  [CubeFieldType.DATE]: () => CubeField.Date(),
  [CubeFieldType.PUBLIC_KEY]: () => CubeField.PublicKey(),
  [CubeFieldType.PMUC_UPDATE_COUNT]: () => CubeField.PmucUpdateCount(),
};

// Next up are a few convenience lookup tables allowing for simplified handling
// of Cube types and their associated field definitions.
export const HasNotify: FieldBooleanParam = {
  [CubeType.FROZEN]: false,
  [CubeType.FROZEN_NOTIFY]: true,
  [CubeType.PIC]: false,
  [CubeType.PIC_NOTIFY]: true,
  [CubeType.MUC]: false,
  [CubeType.MUC_NOTIFY]: true,
  [CubeType.PMUC]: false,
  [CubeType.PMUC_NOTIFY]: true,
};
export const HasSignature: FieldBooleanParam = {
  [CubeType.FROZEN]: false,
  [CubeType.FROZEN_NOTIFY]: false,
  [CubeType.PIC]: false,
  [CubeType.PIC_NOTIFY]: false,
  [CubeType.MUC]: true,
  [CubeType.MUC_NOTIFY]: true,
  [CubeType.PMUC]: true,
  [CubeType.PMUC_NOTIFY]: true,
};
export const RawcontentFieldType: FieldNumericalParam = {
  [CubeType.FROZEN]: CubeFieldType.FROZEN_RAWCONTENT,
  [CubeType.FROZEN_NOTIFY]: CubeFieldType.FROZEN_NOTIFY_RAWCONTENT,
  [CubeType.PIC]: CubeFieldType.PIC_RAWCONTENT,
  [CubeType.PIC_NOTIFY]: CubeFieldType.PIC_NOTIFY_RAWCONTENT,
  [CubeType.MUC]: CubeFieldType.MUC_RAWCONTENT,
  [CubeType.MUC_NOTIFY]: CubeFieldType.MUC_NOTIFY_RAWCONTENT,
  [CubeType.PMUC]: CubeFieldType.PMUC_RAWCONTENT,
  [CubeType.PMUC_NOTIFY]: CubeFieldType.PMUC_NOTIFY_RAWCONTENT,
};
export interface CubeTypeMap { [key: number]: number };
/** Lookup-table to swap notify and non-notify types */
export const ToggleNotifyType: CubeTypeMap = {
  [CubeType.FROZEN]: CubeType.FROZEN_NOTIFY,
  [CubeType.PIC]: CubeType.PIC_NOTIFY,
  [CubeType.MUC]: CubeType.MUC_NOTIFY,
  [CubeType.PMUC]: CubeType.PMUC_NOTIFY,
  [CubeType.FROZEN_NOTIFY]: CubeType.FROZEN,
  [CubeType.PIC_NOTIFY]: CubeType.PIC,
  [CubeType.MUC_NOTIFY]: CubeType.MUC,
  [CubeType.PMUC_NOTIFY]: CubeType.PMUC,
}


// semantic typedef
// TAKE CARE! TRAP! TYPESCRIPT IS CRAP! (that rhymes)
// Never check if something is instanceof CubeKey, it never will be.
// All the underlying lib will ever give us are Buffers, and Typescript will
// gladly allow you to treat a Buffer as CubeKey without correctly downcasting it :(
export class CubeKey extends Buffer {}

// Error definitions
export class CubeError extends VerityError { name = "CubeError" }
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
