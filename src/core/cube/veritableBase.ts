import { BaseField } from "../fields/baseField";
import { BaseFields, FieldPosition } from "../fields/baseFields";
import { FieldParser, FieldDefinition } from "../fields/fieldParser";
import { Settings } from "../settings";
import { CubeOptions, coreCubeFamily } from "./cube";
import { CubeType } from "./cube.definitions";
import { CubeFamilyDefinition } from "./cubeFields";

export class VeritableBaseImplementation {
  protected _fields: BaseFields;
  protected _family: CubeFamilyDefinition;
  protected _cubeType: CubeType;
  readonly requiredDifficulty: number;

  constructor(cubeType: CubeType, options: CubeOptions = {}) {
    this._cubeType = cubeType;
    this._family = options.family ?? coreCubeFamily;
    this._fields = this.normalizeFields(options.fields);
    this.requiredDifficulty = options.requiredDifficulty ?? Settings.REQUIRED_DIFFICULTY;
  }

  get family(): CubeFamilyDefinition { return this._family }
  get cubeType(): CubeType { return this._cubeType }

  get fieldParser(): FieldParser {
    return this.family.parsers[this.cubeType];
  }

  fieldsEqual(other: VeritableBaseImplementation): boolean {
    return this._fields.equals(other._fields);
  }

  get fieldCount(): number { return this._fields.length }

  get byteLength(): number { return this._fields.getByteLength() }

  getFieldLength(fields?: BaseField | BaseField[]): number {
    return this._fields.getByteLength(fields);
  }

  getFields(type?: number | number[]): Iterable<BaseField> {
    return this._fields.get(type);
  }

  getFirstField(type: Number): BaseField {
    return this._fields.getFirst(type);
  }

  sliceFieldsBy(type: Number, includeBefore?: boolean): Iterable<BaseFields> {
    return this._fields.sliceBy(type, includeBefore);
  }

  appendField(field: BaseField): void {
    return this._fields.appendField(field);
  }

  insertFieldInFront(field: BaseField): void {
    return this._fields.insertFieldInFront(field);
  }

  insertFieldAfterFrontPositionals(field: BaseField): void {
    return this._fields.insertFieldAfterFrontPositionals(field);
  }

  insertFieldBeforeBackPositionals(field: BaseField): void {
    return this._fields.insertFieldBeforeBackPositionals(field);
  }

  insertFieldBefore(type: number, field: BaseField): void {
    return this._fields.insertFieldBefore(type, field);
  }

  insertField(field: BaseField, position?: FieldPosition): void {
    return this._fields.insertField(field, position);
  }
  ensureFieldInFront(type: number, defaultField: BaseField | FieldDefinition): void {
    return this._fields.ensureFieldInFront(type, defaultField);
  }

  ensureFieldInBack(type: number, defaultField: BaseField | FieldDefinition): void {
    return this._fields.ensureFieldInBack(type, defaultField);
  }

  removeField(index: number): void;
  removeField(field: BaseField): void;
  removeField(field: number|BaseField): void {
    return this._fields.removeField(field);
  }

  /**
   * Subclasses should override this method to perform any necessary
   * state changes required due to the fact that the field set may now
   * be changes by application layer code in an unpredictable way.
   */
  manipulateFields(): BaseFields {
    return this._fields;
  }

  protected normalizeFields(fields: BaseField | BaseField[] | BaseFields | undefined): BaseFields {
    if (fields instanceof BaseFields) return fields;
    else if (fields instanceof BaseField) return new BaseFields([fields], this.fieldParser.fieldDef);
    else if (Array.isArray(fields)) return new BaseFields(fields, this.fieldParser.fieldDef);
    else return new BaseFields([], this.fieldParser.fieldDef);
  }
}
