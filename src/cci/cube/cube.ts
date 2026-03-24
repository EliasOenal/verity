import type { CubeFamilyDefinition } from "../../core/cube/cubeFields";
import type { CubeField } from "../../core/cube/cubeField";

import type { Veritable } from "./veritable.definition";
import type { Relationship, RelationshipType } from "./relationship";

import { Settings } from "../../core/settings";
import { NetConstants } from "../../core/networking/networkDefinitions";

import { FieldPosition } from "../../core/fields/baseFields";
import { CubeError, CubeType, FieldError, FieldSizeError } from "../../core/cube/coreCube.definitions";
import { CoreCube, CoreVeritableBaseImplementation } from "../../core/cube/coreCube";
import { CubeCreateOptions } from '../../core/cube/coreCube.definitions';

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

    constructor(...args: any[]) {
        super(...args);

        // Reinterpret the args; this is necessary due to a TypeScript
        // limitation requiring mixin constructors to accept any[] as args
        const param1 = args[0] as
            | CubeCreateOptions
            | CoreVeritableBaseImplementation
            | undefined;

        if (param1 instanceof CoreVeritableBaseImplementation) {
            // copy-constructor case
        } else {
            const options = param1 ?? {};
            // options-constructor case
        }
    }

    getRelationships(type?: RelationshipType): Relationship[] {
      const fields: VerityFields = (this as any)._fields;
      return fields.getRelationships(type);
    }
    getFirstRelationship(type?: number): Relationship {
      const fields: VerityFields = (this as any)._fields;
      return fields.getFirstRelationship(type);
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
    if (Settings.RUNTIME_ASSERTIONS && !cube.assertCci?.()) {
      throw new CubeError("Cube.Frozen: Freshly sculpted Cube does not in fact appear to be a CCI Cube");
    }
    return cube;
  }

  /** @deprecated Use Create() directly please */
  static Frozen(options: CubeCreateOptions): Cube {
    options.cubeType = CubeType.FROZEN;
    options.family = options?.family ?? cciFamily;
    const cube: Cube = super.Frozen(options) as Cube;
    if (Settings.RUNTIME_ASSERTIONS && !cube.assertCci?.()) {
      throw new CubeError("Cube.Frozen: Freshly sculpted Cube does not in fact appear to be a CCI Cube");
    }
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
    if (Settings.RUNTIME_ASSERTIONS && !cube.assertCci?.()) {
      throw new CubeError("Cube.MUC: Freshly sculpted Cube does not in fact appear to be a CCI Cube");
    }
    return cube;
  }

  /** Reactivate an existing, binary cube */
  constructor(
    binaryData: Buffer,
    options?: CubeCreateOptions);
  /**
   * Sculpt a new bare Cube, starting out without any fields.
   * This is only useful if for some reason you need full control even over
   * mandatory boilerplate fields. Consider using CoreCube.Frozen or CoreCube.MUC
   * instead, which will sculpt a fully valid frozen Cube or MUC, respectively.
   **/
  constructor(
      cubeType: CubeType,
      options?: CubeCreateOptions);
  /** Copy constructor: Copy an existing Cube */
  constructor(copyFrom: Cube);
  // Repeat implementation as declaration as calls must strictly match a
  // declaration, not the implementation (which is stupid)
  constructor(param1: Buffer | CubeType | Cube, option?: CubeCreateOptions);

  constructor(
    param1: Buffer | CubeType | Cube,
    options: CubeCreateOptions = {},
  ) {
    options.family = options.family ?? cciFamily;
    super(param1, options)
  }

  /** @deprecated Use methods defined in Veritable instead */
  public get fields(): VerityFields {
    if (Settings.RUNTIME_ASSERTIONS && !(this.assertCci())) {
      throw new FieldError("This CCI Cube does not have CCI fields but " + this._fields.constructor.name);
    }
    return this._fields as VerityFields;
  }

  manipulateFields(): VerityFields { return super.manipulateFields() as VerityFields; }

  assertCci(): boolean {
    if (this._fields instanceof VerityFields) return true;
    else return false;
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
