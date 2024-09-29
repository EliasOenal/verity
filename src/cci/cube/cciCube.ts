import { Settings } from "../../core/settings";
import { cciField } from "./cciField";
import { cciFields, cciFieldParsers } from "./cciFields";
import { CubeError, CubeType, FieldError, FieldSizeError } from "../../core/cube/cube.definitions";

import { Cube, CubeCreateOptions, CubeOptions } from "../../core/cube/cube";
import { CubeFamilyDefinition } from "../../core/cube/cubeFields";

import { CubeField } from "../../core/cube/cubeField";
import { NetConstants } from "../../core/networking/networkDefinitions";
import { cciFieldType } from "./cciCube.definitions";

import { Buffer } from 'buffer'
import { KeyPair, deriveSigningKeypair } from "../helpers/cryptography";

export class cciCube extends Cube {
  static Create(
      type: CubeType,
      options: CubeCreateOptions = {},
  ): cciCube {
    options = Object.assign({}, options);  // copy options to avoid messing up original
    options.family ??= cciFamily;
    const cube: cciCube = super.Create(type, options) as cciCube;
    if (Settings.RUNTIME_ASSERTIONS && !cube.assertCci?.()) {
      throw new CubeError("cciCube.Frozen: Freshly sculpted Cube does not in fact appear to be a CCI Cube");
    }
    return cube;
  }

  static Frozen(options: CubeOptions): cciCube {
    options.family = options?.family ?? cciFamily;
    const cube: cciCube = super.Frozen(options) as cciCube;
    if (Settings.RUNTIME_ASSERTIONS && !cube.assertCci?.()) {
      throw new CubeError("cciCube.Frozen: Freshly sculpted Cube does not in fact appear to be a CCI Cube");
    }
    return cube;
  }
  static MUC(
    publicKey: Buffer,
    privateKey: Buffer,
    options?: CubeOptions): cciCube {
    if (options === undefined) options = {};
    options.family = options?.family ?? cciFamily;
    const cube: cciCube = super.MUC(publicKey, privateKey, options) as cciCube;
    if (Settings.RUNTIME_ASSERTIONS && !cube.assertCci?.()) {
      throw new CubeError("cciCube.MUC: Freshly sculpted Cube does not in fact appear to be a CCI Cube");
    }
    return cube;
  }

  // TODO write unit test
  /** !!! May only be called after awaiting sodium.ready !!! */
  static ExtensionMuc(
    masterKey: Buffer,
    fields: cciFields | cciField[],
    subkeyIndex: number = undefined, context: string = undefined,
    writeSubkeyIndexToCube: boolean = false,
    family: CubeFamilyDefinition = cciFamily,
    requiredDifficulty = Settings.REQUIRED_DIFFICULTY
  ): cciCube {
    // masterKey = Uint8Array.from(masterKey);  // will strangely fail in vitest otherwise
    if (!(fields instanceof cciFields)) {
      fields = new cciFields(cciFields as any, family.parsers[CubeType.MUC].fieldDef);
    }
    if (subkeyIndex === undefined) {
      const max: number = Math.pow(2, (Settings.MUC_EXTENSION_SEED_SIZE * 8)) - 1;
      subkeyIndex = Math.floor(  // TODO: Use a proper cryptographic function instead
        Math.random() * max);
    }
    if (context === undefined) context = "MUC extension key";
    const keyPair: KeyPair = deriveSigningKeypair(
      masterKey, subkeyIndex, context);

    if (writeSubkeyIndexToCube) {
      // Write subkey to cube
      // Note: While this information is probably not harmful, it's only ever useful
      // to its owner. Maybe we should encrypt it.
      const nonceBuf = Buffer.alloc(Settings.MUC_EXTENSION_SEED_SIZE);
      nonceBuf.writeUintBE(subkeyIndex, 0, Settings.MUC_EXTENSION_SEED_SIZE);
      fields.appendField(cciField.SubkeySeed(Buffer.from(nonceBuf)));
    }

    // Create and return extension MUC
    const extensionMuc: cciCube = cciCube.MUC(
      keyPair.publicKey, keyPair.privateKey, {
        fields, family, requiredDifficulty
    });
    return extensionMuc;
  }

  constructor(
    param1: Buffer | CubeType,
    options: CubeOptions = {},
  ) {
    options.family = options.family ?? cciFamily;
    super(param1, options)
  }

  /** @deprecated Use methods defined in Veritable instead */
  public get fields(): cciFields {
    if (Settings.RUNTIME_ASSERTIONS && !(this.assertCci())) {
      throw new FieldError("This CCI Cube does not have CCI fields but " + this._fields.constructor.name);
    }
    return this._fields as cciFields;
  }

  assertCci(): boolean {
    if (this._fields instanceof cciFields) return true;
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
        this.getFields(cciFieldType.PADDING);
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
      this.insertFieldBeforeBackPositionals(cciField.Padding(1));
      // now add further padding as required
      const paddingRequired = NetConstants.CUBE_SIZE - len - 1;
      if (paddingRequired) this.insertFieldBeforeBackPositionals(
        cciField.Padding(paddingRequired));
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
}

  // Note: Never move the family definition to another file as it must be
  // executed strictly after the cciCube implementation. You may get uncaught
  // ReferenceErrors otherwise.
  export const cciFamily: CubeFamilyDefinition = {
    cubeClass: cciCube,
    parsers: cciFieldParsers,
  }
