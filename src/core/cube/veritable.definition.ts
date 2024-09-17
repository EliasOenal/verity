import type { BaseField } from "../fields/baseField";
import type { BaseFields, FieldPosition } from "../fields/baseFields";
import type { FieldDefinition } from "../fields/fieldParser";
import type { CubeKey, CubeType } from "./cube.definitions";
import type { CubeFamilyDefinition } from "./cubeFields";

export interface Veritable {
  //###
  // Methods regarding the structure as a whole
  //###

  /** The Cube type used for this veritable structure */
  get cubeType(): CubeType;

  /** The Cube family used, i.e. the local parsing variant used */
  get family(): CubeFamilyDefinition;

  /**
   * @returns This veritable structure's key, if available.
   *   Notably, depending on the type of structure the key may not be
   *   available prior to compilation.
   **/
  getKeyIfAvailable(): CubeKey;
  getKeyStringIfAvailable(): string;

  /**
   * All veritable structures need to be compiled before they can be
   * published. This method asynchroneously compiles the structure and returns
   * a promise to the compile data. The type of compiled data depends on the
   * type of veritable structure.
   */
  compile(): Promise<any>;

  //###
  // Methods regarding fields
  //###

  /**
   * Compares this veritable structure's fields with another's.
   * @param other - The other veritable structure
   * @returns True if the other structure has the same fields with the same
   *   values in the same order, false otherwise.
   **/
  fieldsEqual(other: BaseVeritable): boolean;

  get fieldCount(): number;

  /**
   * @returns The length in bytes of all of this veritable structure's fields,
   *   including any headers if applicable.
   */
  get byteLength(): number;

  /**
   * @param fields - The field or fields to calculate the length of;
   *   all fields if not supplied
   * @returns The length in bytes of all of this veritable structure's fields,
   *   excluding any headers if applicable.
   */
  getFieldLength(fields?: BaseField | BaseField[]): number;

  /**
   * @returns An iterable over all of this veritable structure's fields,
   *   optionally filtered by type
   **/
  getFields(type?: number | number[]): Iterable<BaseField>;

  /** @returns The first field of a specified type */
  getFirstField(type: Number): BaseField;

  /**
   * Splits the list of fields into chunks starting with a field of the
   * specified type.
   * @param [type] The Field type to slice by
   * @param [includeBefore] If the field list does not start with a field of
   * the specified type, this flag determines what to do with the front fields.
   * If true, they will be returned as the first slice.
   * If false, they will not be returned at all.
   * @returns An iterable of field sets.
   */
  sliceFieldsBy(type: Number, includeBefore?: boolean): Iterable<BaseFields>;

  appendField(field: BaseField): void;
  insertFieldInFront(field: BaseField): void;
  insertFieldAfterFrontPositionals(field: BaseField): void;
  insertFieldBeforeBackPositionals(field: BaseField): void;

  /**
   * Inserts a new field before the *first* existing field of the
   * specified type, or at the very end if no such field exists.
   */
  insertFieldBefore(type: number, field: BaseField): void;

  insertField(field: BaseField, position?: FieldPosition): void;

  /**
   * Ensures there is a field of the specified type at the very front of this
   * field list. If a field of such type already exists, it is moved to the
   * front. Otherwise, the supplied defaultField will be inserted at the front.
    * @param defaultField - The default field to use if no field of the specified
    *   type exists. You may alternatively define a field definition if this
    *   field definition defines a default field for the specified type.
   */
  ensureFieldInFront(type: number, defaultField: BaseField | FieldDefinition): void;

  /**
   * Ensures there is a field of the specified type at the very back of this
   * field list. If a field of such type already exists, it is moved to the
   * back. Otherwise, the supplied defaultField will be inserted at the back.
   */
  ensureFieldInBack(type: number, defaultField: BaseField | FieldDefinition): void;


  removeField(index: number): void;
  removeField(field: BaseField): void;


  /**
   * Returns the fields this veritable structure comprises.
   * This method should not be used unless absolutely necessary as it
   * allows manipulating of the underlying fields without giving the
   * veritable structure any chance of responding accordingly.
   * Caller is responsible for ensuring a consistent state afterwards!
   **/
  manipulateFields(): BaseFields;
};

export class BaseVeritable {
  protected _fields: BaseFields;

  fieldsEqual(other: BaseVeritable): boolean {
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
}
