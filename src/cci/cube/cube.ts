import type { CubeFamilyDefinition } from "../../core/cube/cubeFields";
import type { CubeField } from "../../core/cube/cubeField";

import type { Veritable } from "./veritable.definition";
import type { Relationship, RelationshipType } from "./relationship";

import { Settings } from "../../core/settings";
import { NetConstants } from "../../core/networking/networkDefinitions";

import { FieldPosition } from "../../core/fields/baseFields";
import { CubeType, FieldError, FieldSizeError } from "../../core/cube/coreCube.definitions";
import { CoreCube, CoreVeritableBaseImplementation } from "../../core/cube/coreCube";
import { CubeCreateOptions } from '../../core/cube/coreCube.definitions';
import { logger } from "../../core/logger";

import { VerityField } from "./verityField";
import { VerityFields, cciFieldParsers } from "./verityFields";
import { FieldType } from "./cube.definitions";

import { Buffer } from 'buffer';  // for browsers

// Just some TypeScript scaffolding SNAFU: Let's make a typedef for
// a constructor accepting any kind and any number of arguments, as this is what
// Mixins must support.
type Constructor<T = {}> = new (...args: any[]) => T;

/**
 * A Veritable is any Cube-like structure that has the same basic properties as
 * a Cube, e.g. is based on fields, is identified by a unique key, which in turn
 * depends on the Cube type it is based on.
 * Examples of Veritables include obviously Cube (which is the basic block
 * of data in Verity) as well as Veritum (a potentially multi-Cube data structure).
 * This Mixin provides a common implementation of the CCI-level Veritable
 * interface and is intended to be used on top of CoreBaseVeritableImplementation
 * or any class inheriting from it.
 */
export function VeritableMixin<TBase extends Constructor>(Base: TBase) {
  return class VeritableExtended extends Base {

    declare _fields: VerityFields;

    constructor(...args: any[]) {
      const param1 = args[0];

      // CASE 1: Copy constructor
      if (param1 instanceof CoreVeritableBaseImplementation) {
        super(param1);
        return;
      }

      // CASE 2: CubeCreateOptions (only if param1 is a POJO or undefined)
      const isPlainObject =
        param1 !== null &&
        typeof param1 === "object" &&
        Object.getPrototypeOf(param1) === Object.prototype;

      if (param1 === undefined || isPlainObject) {
        const options: CubeCreateOptions = param1 ?? {};
        options.family ??= cciFamily;
        super(options);
        return;
      }

      // CASE 3: Any other constructor overload (e.g. Buffer, number, etc.)
      // → Do not touch args; forward them unchanged.
      super(...args);
    }

    getRelationships(type?: RelationshipType): Relationship[] {
      if (Settings.RUNTIME_ASSERTIONS) this.assertCci();
      return this._fields.getRelationships(type);
    }
    getFirstRelationship(type?: number): Relationship {
      if (Settings.RUNTIME_ASSERTIONS) this.assertCci();
      return this._fields.getFirstRelationship(type);
    }

    assertCci(raise: boolean = true): boolean {
      // check if fields is a CCI-level object
      // (in particular, this asserts no core-level fields objects snook in here)
      if (!(this._fields instanceof VerityFields)) {
        const msg = `CCI VeritableMixin.assertCci(): Veritable does not have CCI VerityFields but ${(this._fields as any)?.constructor?.name}.`;
        if (raise) throw new FieldError(msg);
        logger.error(msg);
        return false;
      }
      // all checks passed
      return true;
    }

  };
}

/**
 * Cubes are Verity's fundamental building block, each containing a fixed amount
 * of data split into fields, each field containing a single record of data.
 * This is the CCI-level implementation of Cube, extending the core-level
 * implementation by features such as TLV fields and supporting high level
 * concepts such as CCI Relationships.
 */
export class Cube extends VeritableMixin(CoreCube) implements Veritable {
  static Create(
      options: CubeCreateOptions = {},
  ): Cube {
    options = Object.assign({}, options);  // copy options to avoid messing up original
    options.family ??= cciFamily;
    const cube: Cube = super.Create(options) as Cube;
    if (Settings.RUNTIME_ASSERTIONS) cube.assertCci();
    return cube;
  }

  /** @deprecated Use Create() directly please */
  static Frozen(options: CubeCreateOptions): Cube {
    options.cubeType = CubeType.FROZEN;
    options.family = options?.family ?? cciFamily;
    const cube: Cube = super.Frozen(options) as Cube;
    if (Settings.RUNTIME_ASSERTIONS) cube.assertCci();
    return cube;
  }
  /** @deprecated Use Create() directly please */
  static MUC(
      publicKey: Buffer,
      privateKey: Buffer,
      options?: CubeCreateOptions,
  ): Cube {
    options.cubeType = CubeType.MUC;
    if (options === undefined) options = {};
    options.family = options?.family ?? cciFamily;
    const cube: Cube = super.MUC(publicKey, privateKey, options) as Cube;
    if (Settings.RUNTIME_ASSERTIONS) cube.assertCci();
    return cube;
  }

  /** Reactivate an existing, binary cube */
  constructor(
    binaryData: Buffer,
    options?: CubeCreateOptions);
  /**
   * Sculpt a new bare CCI (application-level) Cube, starting out without any fields.
   * This is only useful if for some reason you need full control even over
   * mandatory boilerplate fields. Consider using Cube.Create which will
   * sculpt a fully valid Cube including a valid field for the chosen Cube type.
   **/
  constructor(options?: CubeCreateOptions);
  /** Copy constructor: Copy an existing Cube */
  constructor(copyFrom: Cube);
  // Repeat implementation as declaration as calls must strictly match a
  // declaration, not the implementation (which is stupid)
  constructor(param1: Buffer | Cube | CubeCreateOptions, option?: CubeCreateOptions);

  constructor(
    param1: Buffer | Cube | CubeCreateOptions,
    options: CubeCreateOptions = {},
  ) {
    // Reactivation-case is handles here because it's a Cube-specific
    // special case and not covered by the CCI level Veritable implementation
    if (Buffer.isBuffer(param1)) {
      options.family ??= cciFamily;
    }
    super(param1, options)
  }

  /** @deprecated Use methods defined in Veritable instead */
  public get fields(): VerityFields {
    if (Settings.RUNTIME_ASSERTIONS) this.assertCci();
    return this._fields as VerityFields;
  }

  manipulateFields(): VerityFields {
    if (Settings.RUNTIME_ASSERTIONS) this.assertCci();
    return super.manipulateFields() as VerityFields;
  }

  /**
   * Automatically add Padding to reach full Cube length.
   * You don't need to call that manually, we will do that for you whenever
   * you request binary data. It can however safely be called multiple times.
   */
  public padUp(): boolean {
    let len = this.getFieldLength();  // how large are we now?
    if (len > NetConstants.CUBE_SIZE) {  // Cube to large :(
      // is this a recompile and we need to strip out the old padding?
      const paddingFields: Iterable<CubeField> =
        this.getFields(FieldType.PADDING);
      for (const paddingField of paddingFields) {
        this.removeField(paddingField);
      }
      len = this.getFieldLength();
      if (len > NetConstants.CUBE_SIZE) {  // still to large :(
        throw new FieldSizeError(
          `Cannot compile this Cube as it is too large. Current ` +
          `length is ${len}, maximum is ${NetConstants.CUBE_SIZE}`);
      }
    }
    if (len < NetConstants.CUBE_SIZE) {  // any padding required?
      // start with a 0x00 single byte padding field to indicate end of CCI data
      this.insertFieldBeforeBackPositionals(VerityField.Padding(1));
      // now add further padding as required
      const paddingRequired = NetConstants.CUBE_SIZE - len - 1;
      if (paddingRequired) this.insertFieldBeforeBackPositionals(
        VerityField.Padding(paddingRequired));
      this.cubeManipulated();
      return true;
    } else return false;
  }

  // As we're using TLV fields in CCI but don't in the core, we need to ensure
  // our Cube is of the correct size before passing it down to the core for
  // compilation.
  compile(): Promise<void> {
    this.padUp();
    return super.compile();
  }

  //###
  // Expose field methods
  //###

  insertTillFull(
    fields: Iterable<CubeField>,
    position: FieldPosition = FieldPosition.BEFORE_BACK_POSITIONALS,
  ): number {
    return (this._fields as VerityFields).insertTillFull(fields, position);
  }

}

  // Note: Never move the family definition to another file as it must be
  // executed strictly after the cciCube implementation. You may get uncaught
  // ReferenceErrors otherwise.
  export const cciFamily: CubeFamilyDefinition = {
    cubeClass: Cube,
    parsers: cciFieldParsers,
  }
