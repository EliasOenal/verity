import type { CubeFamilyDefinition } from "../../core/cube/cubeFields";
import type { CubeField } from "../../core/cube/cubeField";
import type { Relationship, RelationshipType } from "./relationship";

import { Settings } from "../../core/settings";
import { NetConstants } from "../../core/networking/networkDefinitions";

import { FieldPosition } from "../../core/fields/baseFields";
import { CubeError, CubeType, FieldError, FieldSizeError } from "../../core/cube/coreCube.definitions";
import { CoreCube } from "../../core/cube/coreCube";
import { CubeCreateOptions } from '../../core/cube/coreCube.definitions';

import { VerityField } from "./verityField";
import { VerityFields, cciFieldParsers } from "./verityFields";
import { FieldType } from "./cube.definitions";

import { Buffer } from 'buffer';  // for browsers

export class Cube extends CoreCube {
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
  // TODO: move this to CCI or get rid of it entirely --
  // since the core no longer handles variable length fields at all
  // it has no notion of padding anymore
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

  getRelationships(type?: RelationshipType): Relationship[] {
    return (this._fields as VerityFields).getRelationships(type);
  }
  public getFirstRelationship(type?: number): Relationship {
    return (this._fields as VerityFields).getFirstRelationship(type);
  }
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
