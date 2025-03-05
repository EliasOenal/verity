import { Settings } from "../../core/settings";
import { NetConstants } from "../../core/networking/networkDefinitions";

import { CubeError, CubeKey, CubeType, HasNotify, ToggleNotifyType } from "../../core/cube/cube.definitions";
import { Cube, CubeCreateOptions, CubeOptions } from "../../core/cube/cube";
import { FieldParser } from "../../core/fields/fieldParser";

import { cciCube } from "../cube/cciCube";
import { FieldType } from "../cube/cciCube.definitions";
import { VerityField } from "../cube/verityField";
import { cciFrozenFieldDefinition, VerityFields } from "../cube/verityFields";
import { Relationship, RelationshipType } from "../cube/relationship";
import { Veritable } from "../../core/cube/veritable.definition";
import { Veritum } from "./veritum";

import { Buffer } from 'buffer'
import { DoublyLinkedList, DoublyLinkedListNode } from 'data-structure-typed/dist/esm';
import { logger } from "../../core/logger";

/**
 * Don't split fields if a resulting chunk would be smaller than this amount
 * of bytes. Don't set this to anything less than a minimal variable length
 * field (3) or things will break horribly!
 **/
const MIN_CHUNK = 10;

export interface SplitOptions extends RecombineOptions {
  /**
   * The maximum number of bytes to use in each chunk.
   * You can set this to something smaller than the cube size if you need
   * to reserve some space in each chunk, e.g. for crypto overhead.
   * @default - A full Cube, i.e. 1024 bytes.
   */
  maxChunkSize?: (chunkIndex: number) => number;

  /**
   * Optionally, a callback that will be called while each chunk is getting
   * finalised.
   * @param chunk - The chunk being finalised
   * @param state - The current finalisation state, including the running number
   *   of the current chunk as well as the total number of chunk Cubes.
   * @returns
   */
  chunkTransformationCallback?: (chunk: cciCube, state: ChunkFinalisationState) => void;
}

export interface RecombineOptions extends CubeCreateOptions {
  // TODO these are not really CubeOptions; I can't define fields here.
  //   All it uses from CubeOptions is CubeType, and even that should probably
  //   just be derived from the first chunk or something.
  /**
   * Fields to exclude from splitting. Those will not be included in the
   * resulting chunks.
   * It is not recommended to override the default settings except to add
   * further exclusion.
   * If you do, be sure to know what you're doing.
   * Otherwise be prepared for errors thrown or unexpected results.
   * @default - All core/positional fields, as well as CCI end markers and
   *   padding fields. When overriding please note that it will usually be
   *   wise to still include those in your custom exclude list. You can do this
   *   by copying and amending Continuation.ContinuationDefaultExclusions.
   **/
  exclude?: number[],

  /**
   * If mentioned in this map, Split() will copy the first input field of the
   * specified type to the n-th chunk, as represented by the mapped value.
   * Recombine() will do the reverse.
   * - Note that chunk numbers start at 0.
   * - The special mapped value -1 will cause Split() to copy the field to all chunks,
   *   and Recombine() to retain the field from the first chunk.
   * - Note that field mapping is a separate operation independent from regular
   *   splitting. You will want to ensure any mapped fields are also excluded.
   * By default, we use this feature to:
   * - ensure all chunks have the same date
   *   (note: this is only relevant for plaintext Verita as we will be default
   *   randomise the date on each chunk for encrypted Verita)
   * - theoretically, to preserve the PMUC update count, be we currently don't
   *   even support signed multi-chunk Verita
   */
  mapFieldToChunk?: Map<number, number>;
}

interface SplitState {
  spaceRemaining: number,
  macroFieldsetNode: DoublyLinkedListNode<VerityField>,
}

export interface ChunkFinalisationState {
  chunkIndex: number;
  chunkCount: number;
}

export const ContinuationDefaultExclusions: number[] = [
  // Cube positionals
  FieldType.TYPE, FieldType.NOTIFY, FieldType.PMUC_UPDATE_COUNT,
  FieldType.PUBLIC_KEY, FieldType.DATE, FieldType.SIGNATURE,
  FieldType.NONCE, FieldType.PMUC_UPDATE_COUNT,
  // raw / non-CCI content fields
  FieldType.FROZEN_RAWCONTENT, FieldType.FROZEN_NOTIFY_RAWCONTENT,
  FieldType.PIC_RAWCONTENT, FieldType.PIC_NOTIFY_RAWCONTENT,
  FieldType.MUC_RAWCONTENT, FieldType.MUC_NOTIFY_RAWCONTENT,
  FieldType.PMUC_RAWCONTENT, FieldType.PMUC_NOTIFY_RAWCONTENT,
  // non-content bearing CCI fields
  FieldType.CCI_END, FieldType.PADDING,
  // virtual / pseudo fields
  FieldType.REMAINDER,
] as const;

const DefaultMapFieldToChunk: Map<number, number> = new Map([
  [FieldType.DATE, -1],
  [FieldType.NOTIFY, 1],
  [FieldType.PMUC_UPDATE_COUNT, 0],
]);


/**
 * Hi, I'm Split()!
 * Got a Cube that's too large?
 * Field that's longer than the cube size?
 * Just too many fields?
 * Or maybe both?
 * No worries, I'll split them up for you.
 * @param veritum A CCI Veritum or any other veritable (Cube-like) structure
 *   to be split into Cubes.
 * @param options
 * @returns An array of chunk Cubes
 */
export async function Split(
  veritum: Veritable,
  options?: SplitOptions,
): Promise<cciCube[]> {
  const splitter = new Splitter(veritum, options);
  splitter.preProcess();
  splitter.split();
  await splitter.finalise();
  return splitter.cubes;
}


// Maybe TODO: The current Continuation implementation is pretty much
// unusable for mutable Cubes as it does not try to minimise the number
// of changed Cubes.
/**
 * Internal helper class instantiated to split a single input Veritum.
 *
 * A bit of internal nomenclature:
 * - We call the stuff the caller asks us to split the "input Veritum"
 * - The result of a split are the "chunk Cubes"
 * - Once we've figured out which fields of the input Veritum actually should be
 *   included in the chunk Cubes, we call this the "macro fieldset"
 */
class Splitter {
  // input members
  private veritum: Veritable;
  private cubeType: CubeType;
  private options: SplitOptions = {};
  private macroFieldset: DoublyLinkedList<VerityField>

  // pre-processing related members
  private minBytesRequred = 0;  // will get counted in preProcess()
  private maxChunkIndexPlanned = 0;

  // splitting related members
  private chunkIndex = -1;
  readonly cubes: cciCube[] = [];
  private demoChunk: Cube;

  /**
   * A list of "empty" CONTINUED_IN references created by split(),
   * to be filled in later by finalise().
   * Note the number of CONTINUED_IN references will always be one less than
   * the number of Cubes.
   */
  private refs: VerityField[] = [];


  constructor(veritum: Veritable, options: SplitOptions = {}) {
    // set member attributes
    this.veritum = veritum;
    this.cubeType = veritum.cubeType;
    this.options = options;

    // set default options
    options.exclude ??= ContinuationDefaultExclusions;
    options.maxChunkSize ??= () => NetConstants.CUBE_SIZE;
    options.mapFieldToChunk ??= DefaultMapFieldToChunk;

    // Handle a special case:
    // If the input Veritum is of a notification type, use its base
    // (non-notification) variant instead.
    // If we are actually going to set a notification on one or more chunks,
    // these chunks will automatically be switched back to notification types
    // (by VeritableBaseImplementation based on the fact that a NOTIFY field is present)
    if (HasNotify[this.cubeType]) this.cubeType = ToggleNotifyType[this.cubeType];

    // Construct a demo chunk which will be used to help determine the
    // available space per chunk.
    // this.demoFieldset = VerityFields.DefaultPositionals(
    //   this.veritum.fieldParser.fieldDef) as VerityFields;
    this.demoChunk = this.veritum.family.cubeClass.Create({
      cubeType: this.cubeType,
      requiredDifficulty: 0,
      publicKey: this.veritum.publicKey,
      privateKey: this.veritum.privateKey,
    })
  }


  /**
   * Pre-process the Veritum supplied, i.e. plan the upcoming split.
   * This is the first step of the splitting process.
   **/
  preProcess(): void {
    this.macroFieldset = new DoublyLinkedList();
    let previousField: VerityField = undefined;
    for (const field of this.veritum.getFields()) {
      // - Only accept non-excluded fields from supplied Veritum, i.e. everything
      //   except non-payload boilerplate. Pre-exisiting CONTINUED_IN relationships
      //   will also be dropped.
      if (!this.options.exclude.includes(field.type) && (
            field.type !== FieldType.RELATES_TO ||
            Relationship.fromField(field).type !== RelationshipType.CONTINUED_IN
          )
      ){
        // Handle edge case: if this is a variable length field and the previous
        // field is of the same type, separate them by a minimal PADDING field.
        // This is to avoid them being interpreted as a split field on
        // reconstruction.
        if (previousField !== undefined &&
            previousField.type === field.type &&
            this.veritum.fieldParser.fieldDef.fieldLengths[field.type] === undefined)
        {
          const padding = new VerityField(FieldType.PADDING, Buffer.alloc(0));
          this.macroFieldset.push(padding);
          this.minBytesRequred += this.veritum.getFieldLength(padding);
        }

        // Now finally accept this field into our macro fieldset.
        // We will also make a copy of the field to avoid messing with the
        // original data.
        const copy: VerityField =
          new this.veritum.fieldParser.fieldDef.fieldObjectClass(field);
        this.macroFieldset.push(copy);
        this.minBytesRequred += this.veritum.getFieldLength(field);
        previousField = field;
      }
    }
  }


  /**
   * Perform the actual splitting of the macro fieldset into chunk Cubes,
   * This is the second step of the splitting process.
   */
  split(): void {
    // start by creating the first chunk
    let chunk = this.sculptNextChunk();
    // Let's figure out how much space we have available in the first Chunk.
    // Our demo chunk will help us do that.
    // Additionally, the caller may restrict the space we are allowed to use
    // for each chunk.
    let bytesAvailableThisChunk: number =
      this.demoChunk.bytesRemaining(this.options.maxChunkSize(this.chunkIndex));

    // Prepare the split by initialising our state:
    // - We obviously start at the first input fields, and
    // - we start by planning just a single chunk Cube
    //   (we'll calculate this properly in a moment)
    const state: SplitState = {
      macroFieldsetNode: this.macroFieldset.head,
      spaceRemaining: bytesAvailableThisChunk,
    }

    // Iterate over the input fieldset
    while (state.macroFieldsetNode !== undefined) {
      // First, let's calculate how many chunk Cubes we'll need in total.
      // Note that we do this inside the loop as the space required may increase
      // as we split fields, due to splitting overhead.
      this.planChunks(state);

      // Finally, have a look at the current field and decide what to do with it.
      const field: VerityField = state.macroFieldsetNode.value;
      const bytesRemaining = chunk.fields.bytesRemaining(this.options.maxChunkSize(this.chunkIndex));

      // There's three (3) possible cases to consider:
      // Case 1): If the next field entirely fits in the current cube,
      // just insert it and be done with it
      if (bytesRemaining >= chunk.getFieldLength(field)) {
        chunk.insertFieldBeforeBackPositionals(field);
        state.spaceRemaining -= chunk.getFieldLength(field);
        this.minBytesRequred -= chunk.getFieldLength(field);
        // We're done with this field, so let's advance the iterator
        state.macroFieldsetNode = state.macroFieldsetNode.next;
      }

      // Case 2): We may be able to split this field into two smaller chunks.
      // Two conditions must be satisfied to split:
      // - The remaining space in the Cube must be at least our arbitrarily
      //   decided minimum chunk size.
      // - The field must be variable length as fixed length field cannot be
      //   split (it would break the parser).
      else if (bytesRemaining >= MIN_CHUNK &&
        this.veritum.fieldParser.fieldDef.fieldLengths[field.type] === undefined) {
        // If we've entered this block, we've determined that we can split this field,
        // so let's determine the exact location of the split point:
        const headerSize = FieldParser.getFieldHeaderLength(
          field.type, this.veritum.fieldParser.fieldDef);
        const maxValueLength = bytesRemaining - headerSize;
        // Split the field into two chunks:
        const fieldPartial1: VerityField = new VerityField(
          field.type,
          field.value.subarray(0, maxValueLength)
        );
        const fieldPartial2: VerityField = new VerityField(
          field.type,
          field.value.subarray(maxValueLength)
        );
        // Place the first chunk in the current Cube
        chunk.insertFieldBeforeBackPositionals(fieldPartial1);
        // Update our accounting:
        // Space remaining is reduced by the size of the first chunk; but
        // minBytesRequired is only reduces by the amount of payload actually
        // placed in chunk1. Splitting wastes space!
        state.spaceRemaining -= chunk.getFieldLength(fieldPartial1);
        this.minBytesRequred -= fieldPartial1.value.length;
        // Replace the field on our macro fieldset with the two chunks;
        // this way, chunk2 will automatically be handled on the next iteration.
        state.macroFieldsetNode.value = fieldPartial1;
        this.macroFieldset.addAfter(state.macroFieldsetNode, fieldPartial2);
        // We're done with this field, so let's advance the iterator
        state.macroFieldsetNode = state.macroFieldsetNode.next;
      }

      // Case 3: We can't split this field, and there's no way we're going
      // to fit any of it in the current chunk Cube.
      // Any space left in this chunk Cube will be wasted and we're going
      // to roll over to the next chunk.
      else {
        // First update our accounting...
        state.spaceRemaining -= chunk.fields.bytesRemaining(this.options.maxChunkSize(this.chunkIndex));
        // ... and then it's time for a chunk rollover!
        chunk = this.sculptNextChunk();
        bytesAvailableThisChunk =
          this.demoChunk.bytesRemaining(this.options.maxChunkSize(this.chunkIndex));
        // Note that we have not handled this field!
        // We therefore must not advance the iterator.
      }
    }
  }


  /**
   * Compile the split chunks and fill in the CONTINUED_IN references.
   * This is the third and final step of the splitting process.
   */
  async finalise(): Promise<void> {
    // Chunking done. Now fill in the CONTINUED_IN references.
    // This will also compile all chunk Cubes but the first one.
    // If a chunk transformation callback was specified (e.g. encryption),
    // call it right before compiling each Cube.
    if (Settings.RUNTIME_ASSERTIONS && (this.refs.length !== (this.cubes.length-1))) {
      throw new CubeError("Continuation.SplitCube: I messed up my chunking. This should never happen.");
    }
    for (let i=0; i<this.refs.length; i++) {
      // the first relationship field needs to reference the second Cube, and so on
      const referredCube = this.cubes[i+1];
      // we will go ahead and compile the referred Cube -- if there's a chunk
      // transformation callback, call it now
      if (this.options.chunkTransformationCallback !== undefined) {
        this.options.chunkTransformationCallback(referredCube,
          { chunkIndex: i+1, chunkCount: this.refs.length }
        );
      }
      const referredKey: CubeKey = await referredCube.getKey();  // compiles the Cube
      const correctRef: Relationship =
        new Relationship(RelationshipType.CONTINUED_IN, referredKey);
      const compiledRef: VerityField = VerityField.RelatesTo(correctRef);
      // fill in the correct ref value to the field we created at the beginning
      this.refs[i].value = compiledRef.value;
    }
    // Compile first chunk Cube for consistency.
    // Of course, also call the chunk transformation callback if there's one.
    if (this.options.chunkTransformationCallback !== undefined) {
      this.options.chunkTransformationCallback(this.cubes[0],
        { chunkIndex: 0, chunkCount: this.refs.length }
      );
    }
    await this.cubes[0].compile();
  }


  /**
   * This is a split() partial.
   * It is performs the chunk rollover, i.e. sculpts the next chunk.
   * It's called at the very beginning of the splitting process, and whenever
   * we've filled up the previous chunk.
   */
  private sculptNextChunk(): cciCube {
    // First, update the running number
    this.chunkIndex++;

    // Did caller ask us to map any fields statically to certain chunks?
    const mappedFields: VerityField[] = [];
    if (this.options.mapFieldToChunk) {
      for (const [fieldType, targetIndex] of this.options.mapFieldToChunk) {
        // Map this field if we were asked to map it to this very chunk,
        // or if we were asked to map it to every chunk (denoted by -1)
        if (targetIndex === this.chunkIndex || targetIndex === -1) {
          const field: VerityField = this.veritum.getFirstField(fieldType);
          if (field) mappedFields.push(field);
        }
      }
    }

    // Finally, sculpt the chunk Cube
    const cube = this.veritum.family.cubeClass.Create({
      ...this.options,
      cubeType: this.cubeType,
      fields: mappedFields,
    }) as cciCube;
    this.cubes.push(cube);
    return cube;
  }


  /**
   * This is a split() partial.
   * It prepares continuation references and insert them into the macro fieldset.
   * - Note that these references start out "empty" as we don't know the chunk
   *   Cube's keys yet -- the correct next chunk references will later be filled
   *   in by finalise().
   * - We place as much references as we can right at the beginning of the chain
   *   rather than chaining the Cubes
   *   individually. This is to allow light clients to fetch the continuation
   *   Cubes in one go.
   *   Note that individually chained Cubes are still valid
   *   and will be processed correctly.
   * - Note that this function gets re-called for every input field.
   *   This is to recalculate the required number of chunks, as
   *   wasted space due to not perfectly splittable fields may increase
   *   required chunk count.
   * @param state - The current split state, i.e. local variable used and
   *   updated as we itereate over macro fields.
   * @returns The updated split state
   */
  private planChunks(state: SplitState): void {
    let refsAdded = 0;
    // do we need more space?
    while (state.spaceRemaining < this.minBytesRequred) {
      // more space needed!
      // add another CONTINUED_IN reference, i.e. plan for an extra Cube
      const rel: Relationship = new Relationship(
        RelationshipType.CONTINUED_IN, Buffer.alloc(
          NetConstants.CUBE_KEY_SIZE, 0));  // dummy key for now
      const refField: VerityField = VerityField.RelatesTo(rel);
      // remember this ref as a planned Cube...
      this.refs.push(refField);
      this.maxChunkIndexPlanned++;
      // ... and add it to our field list, as obviously the reference needs
      // to be written. Keep count of how many of those we added, as we'll
      // need to backtrack this many nodes in macroFieldset in order not to
      // skip over anything.
      this.macroFieldset.addBefore(state.macroFieldsetNode, refField);
      refsAdded++;
      // account for the space we gained by planning for an extra Cube
      // as well as the space we lost due to the extra reference
      state.spaceRemaining +=
        this.demoChunk.bytesRemaining(this.options.maxChunkSize(this.maxChunkIndexPlanned));
      this.minBytesRequred += this.veritum.getFieldLength(refField);
    }
    // if we inserted extra fields, backtrack that many nodes
    // so that the extra field will actually get processed
    for (let i = 0; i < refsAdded; i++) {
      state.macroFieldsetNode = state.macroFieldsetNode.prev;
    }
  }
}



export function Recombine(
  chunks: Iterable<cciCube>,
  options: RecombineOptions = {},
): Veritum {
  // set default options
  options.exclude ??= ContinuationDefaultExclusions;
  options.mapFieldToChunk ??= DefaultMapFieldToChunk;

  // Normalise input chunks to Array
  // maybe TODO optimise: avoid this?
  chunks = Array.from(chunks);

  // prepare variables
  let cubeType: CubeType;
  let fields: VerityFields;  // will be initialized late below

  // iterate through all chunk Cubes...
  for (const cube of chunks) {
    if (fields === undefined) {
      // late initialisation of our macro fields object because we base the type of Cube
      // on the first chunk supplied -- and as we accept an iterable we need
      // to be iterating to be able to look at it
      cubeType = cube.cubeType;
      fields = new VerityFields([], cube.fieldParser.fieldDef);
    }

    for (const field of cube.fields.all) {
      // ... and look at each field:
      // - Excluded fields will be dropped, except PADDING which separates
      //   non-rejoinable adjacent fields
      if (field.type !== FieldType.PADDING &&
          options.exclude.includes(field.type)) continue;
      // - CONTINUED_IN references will be dropped
      if (field.type === FieldType.RELATES_TO) {
        const rel = Relationship.fromField(field);
        if (rel.type === RelationshipType.CONTINUED_IN) continue;
      }
      // - variable length fields of same type directly adjacent to each
      //   other will be merged
      const previousField: VerityField =
        fields.length > 0 ?
          // TODO: get rid of unsafe manipulateFields() call
          fields.all[fields.length-1] :
          undefined;
      if (previousField !== undefined && field.type === previousField.type &&
          fields.fieldDefinition.fieldLengths[field.type] === undefined) {
        previousField.value = Buffer.concat([previousField.value, field.value]);
        continue;
      }
      // - the rest will just be copied to the macro fieldset
      const fieldType = field.constructor as typeof VerityField;
      const copy: VerityField = new fieldType(field);
      fields.appendField(copy);
    }
  }
  // handle edge case: don't fail on empty chunk list
  if (cubeType === undefined) cubeType = CubeType.FROZEN;
  if (fields === undefined) fields = new VerityFields([], cciFrozenFieldDefinition);

  // in a second pass, remove any PADDING fields
  for (let i=0; i<fields.length; i++) {
    // TODO: get rid of unsafe manipulateFields() calls
    if (fields.all[i].type === FieldType.PADDING) {
      fields.all.splice(i, 1);
      i--;
    }
  }

  // In addition to regular recombination, perform any reverse field-to-chunk
  // mapping if requested
  if (options.mapFieldToChunk) {
    for (let [fieldType, targetIndex] of options.mapFieldToChunk) {
      // handle special case: fields mapped to every chunk will be restored
      // from the first chunk
      if (targetIndex === -1) targetIndex = 0;
      // fetch mapped field
      const chunk: cciCube = chunks[targetIndex];
      if (!chunk) {
        logger.warn(`Recombine(): I was asked to map a ${FieldType[fieldType]} field from chunk ${targetIndex} to the restored Veritum, but this chunk does not exist; skipping this field.`);
        continue;
      }
      const field: VerityField = chunk.getFirstField(fieldType);
      if (!field) {
        // Note: Not printing a warning as this case is normal, e.g. any
        //   non-notification Veritum will not have a NOTIFY field,
        //   but NOTIFY is still in the map by default.
        continue;
      }
      fields.insertFieldInFront(field);
    }
  }

  // wrap our reconstructed fields into a Veritum object and return it
  const veritum = new Veritum({
    ...options,
    cubeType: cubeType,
    fields: fields,

    // Have the reconstructed Veritum retain its original chunks so it stays
    // in compiled state and knows its key.
    // TODO: make retaining chunks optional as it increases memory consuption
    //  by a factor of 3 (decrypted fields, encrypted fields, raw encrypted binary blob) --
    //  not retaining the chunks will basically yield an uncompiled Veritum,
    //  which as it's in uncompiled state may not know its key
    chunks: chunks as cciCube[],

    publicKey: chunks?.[0]?.publicKey,  // only relevant for signed types, undefined otherwise
  });
  return veritum;
}
