import { ApiMisuseError, Settings, VerityError } from "../../core/settings";
import { NetConstants } from "../../core/networking/networkDefinitions";

import { CubeError, CubeKey } from "../../core/cube/cube.definitions";
import { Cube, CubeOptions } from "../../core/cube/cube";
import { FieldDefinition, FieldParser } from "../../core/fields/fieldParser";

import { cciCube } from "../cube/cciCube";
import { cciFieldType } from "../cube/cciCube.definitions";
import { cciField } from "../cube/cciField";
import { cciFields } from "../cube/cciFields";
import { cciRelationship, cciRelationshipType } from "../cube/cciRelationship";

import { Buffer } from 'buffer'

// HACKHACK: jest does throw strange errors which I don't understand when trying
// to import this lib properly.
// We should consider dumping jest and using vitest instead; ESM support in
// jest is still buggy and keeps causing problems.
import { DoublyLinkedList, DoublyLinkedListNode } from 'data-structure-typed';
import { Veritable } from "../../core/cube/veritable.definition";
import { Veritum } from "./veritum";

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

  chunkTransformationCallback?: (chunk: cciCube, splitState: SplitState) => void;
}

export interface RecombineOptions extends CubeOptions {
  /**
   * Fields to exclude from splitting. Those will not be included in the
   * resulting chunks.
   * @default - All core/positional fields, as well as CCI end markers and
   *   padding fields. When overriding please note that it will usually be
   *   wise to still include those in your custom exclude list. You can do this
   *   by copying and amending Continuation.ContinuationDefaultExclusions.
   **/
  exclude?: number[],
}

export interface SplitState {
  chunkIndex: number;
  chunkCount: number;
}


export class Continuation {
  // Maybe TODO: The current Continuation implementation is pretty much
  // unusable for mutable Cubes as it does not try to minimise the number
  // of changed Cubes.

  static readonly ContinuationDefaultExclusions: number[] = [
    // Cube positionals
    cciFieldType.TYPE, cciFieldType.NOTIFY, cciFieldType.PMUC_UPDATE_COUNT,
    cciFieldType.PUBLIC_KEY, cciFieldType.DATE, cciFieldType.SIGNATURE,
    cciFieldType.NONCE,
    // raw / non-CCI content fields
    cciFieldType.FROZEN_RAWCONTENT, cciFieldType.FROZEN_NOTIFY_RAWCONTENT,
    cciFieldType.PIC_RAWCONTENT, cciFieldType.PIC_NOTIFY_RAWCONTENT,
    cciFieldType.MUC_RAWCONTENT, cciFieldType.MUC_NOTIFY_RAWCONTENT,
    cciFieldType.PMUC_RAWCONTENT, cciFieldType.PMUC_NOTIFY_RAWCONTENT,
    // non-content bearing CCI fields
    cciFieldType.CCI_END, cciFieldType.PADDING,
  ];

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
  static async Split(
      veritum: Veritable,
      options: SplitOptions = {},
  ): Promise<cciCube[]> {
    // set default options
    options.exclude ??= Continuation.ContinuationDefaultExclusions;
    options.maxChunkSize ??= () => NetConstants.CUBE_SIZE;

    // Pre-process the Veritum supplied:
    let minBytesRequred = 0;  // will count them in a moment
    const macroFieldset: DoublyLinkedList<cciField> = new DoublyLinkedList();
    let previousField: cciField = undefined;
    for (const field of veritum.getFields()) {
      // - Only accept non-excluded fields from supplied Veritum, i.e. everything
      //   except non-payload boilerplate. Pre-exisiting CONTINUED_IN relationships
      //   will also be dropped.
      if (!options.exclude.includes(field.type) && (
            field.type !== cciFieldType.RELATES_TO ||
            cciRelationship.fromField(field).type !== cciRelationshipType.CONTINUED_IN
          )
      ){
        // Handle edge case: if this is a variable length field and the previous
        // field is of the same type, separate them by a minimal PADDING field.
        // This is to avoid them being interpreted as a split field on
        // reconstruction.
        if (previousField !== undefined &&
            previousField.type === field.type &&
            veritum.fieldParser.fieldDef.fieldLengths[field.type] === undefined)
        {
          const padding = new cciField(cciFieldType.PADDING, Buffer.alloc(0));
          macroFieldset.push(padding);
          minBytesRequred += veritum.getFieldLength(padding);
        }

        // now finally accept this field into our macro fieldset
        macroFieldset.push(field);  // maybe TODO: use less array copying operations
        minBytesRequred += veritum.getFieldLength(field);
        previousField = field;
      }
    }


    // Split the macro fieldset into Cubes:
    // prepare the list of Cubes and initialise the first one
    const cubes: cciCube[] = [ veritum.family.cubeClass.Create(veritum.cubeType, options) as cciCube ];
    let chunkIndex = 0;
    let cube: cciCube = cubes[chunkIndex];
    let maxChunkIndexPlanned = 0;

    // Prepare some data allowing us to figure out how much space we have
    // available in each chunk Cube.
    // The caller may restrict the space we are allowed to use for each chunk.
    // In addition to that, we need to account for core boilerplate fields --
    // we'll construct a demo fieldset to determine how much space is lost to that.
    const demoFieldset: cciFields =
      cciFields.DefaultPositionals(veritum.fieldParser.fieldDef) as cciFields;
    // We'll begin by figuring out the available space in the first Cube
    let bytesAvailableThisChunk: number =
      demoFieldset.bytesRemaining(options.maxChunkSize(chunkIndex));

    // Also prepare a list of CONTINUED_IN references to be filled in later.
    // Note the number of CONTINUED_IN references will always be one less than
    // the number of Cubes.
    const refs: cciField[] = [];

    let spaceRemaining = bytesAvailableThisChunk;  // we start with just one chunk

    // Iterate over the macro fieldset
    let macroFieldsetNode: DoublyLinkedListNode<cciField> = macroFieldset.head;
    while (macroFieldsetNode !== undefined) {
      // Prepare continuation references and insert them at the front of the
      // macro fieldset. Once we've sculted the split Cubes we will revisit them
      // and fill in the next Cube references. We place as much references as we
      // can right at the beginning of the chain rather than chaining the Cubes
      // individually. This is to allow light clients to fetch the continuation
      // Cubes in one go. Note that individually chained Cubes are still valid
      // and will be processed correctly.
      // Note that we recalculate the required number of Cubes as we go as
      // wasted space due to not perfectly splittable fields may increase
      // that number over time.
      // do we need to plan for more Cubes?
      let refsAdded = 0;
      while (spaceRemaining < minBytesRequred) {
        // add another CONTINUED_IN reference, i.e. plan for an extra Cube
        const rel: cciRelationship = new cciRelationship(
          cciRelationshipType.CONTINUED_IN, Buffer.alloc(
            NetConstants.CUBE_KEY_SIZE, 0));  // dummy key for now
        const refField: cciField = cciField.RelatesTo(rel);
        // remember this ref as a planned Cube...
        refs.push(refField);
        maxChunkIndexPlanned++;
        // ... and add it to our field list, as obviously the reference needs
        // to be written. Keep count of how many of those we added, as we'll
        // need to backtrack this many nodes in macroFieldset in order not to
        // skip over anything.
        macroFieldset.addBefore(macroFieldsetNode, refField);
        refsAdded++;
        // account for the space we gained by planning for an extra Cube
        // as well as the space we lost due to the extra reference
        spaceRemaining +=
          demoFieldset.bytesRemaining(options.maxChunkSize(maxChunkIndexPlanned));
        minBytesRequred += cube.getFieldLength(refField);
      }
      // if we inserted extra fields, backtrack that many nodes
      for (let i = 0; i < refsAdded; i++) macroFieldsetNode = macroFieldsetNode.prev;

      // Finally, have a look at the current field and decide what to do with it.
      const field: cciField = macroFieldsetNode.value;
      const bytesRemaining = cube.fields.bytesRemaining(options.maxChunkSize(chunkIndex));

      // There's three (3) possible cases to consider:
      if (bytesRemaining >= cube.getFieldLength(field)) {
        // Case 1): If the next field entirely fits in the current cube,
        // just insert it and be done with it
        cube.insertFieldBeforeBackPositionals(field);
        spaceRemaining -= cube.getFieldLength(field);
        minBytesRequred -= cube.getFieldLength(field);
        // We're done with this field, so let's advance the iterator
        macroFieldsetNode = macroFieldsetNode.next;
      } else if (bytesRemaining >= MIN_CHUNK &&
        veritum.fieldParser.fieldDef.fieldLengths[field.type] === undefined) {
        // Case 2): We may be able to split this field into two smaller chunks.
        // Two conditions must be satisfied to split:
        // - The remaining space in the Cube must be at least our arbitrarily
        //   decided minimum chunk size.
        // - The field must be variable length as fixed length field cannot be
        //   split (it would break the parser).

        // If we've entered this block, we've determined that we can split this field,
        // so let's determine the exact location of the split point:
        const headerSize = FieldParser.getFieldHeaderLength(
          field.type, veritum.fieldParser.fieldDef);
        const maxValueLength = bytesRemaining - headerSize;
        // Split the field into two chunks:
        const chunk1: cciField = new cciField(
          field.type,
          field.value.subarray(0, maxValueLength)
        );
        const chunk2: cciField = new cciField(
          field.type,
          field.value.subarray(maxValueLength)
        );
        // Place the first chunk in the current Cube
        cube.insertFieldBeforeBackPositionals(chunk1);
        // Update our accounting:
        // Space remaining is reduced by the size of the first chunk; but
        // minBytesRequired is only reduces by the amount of payload actually
        // placed in chunk1. Splitting wastes space!
        spaceRemaining -= cube.getFieldLength(chunk1);
        minBytesRequred -= chunk1.value.length;
        // Replace the field on our macro fieldset with the two chunks;
        // this way, chunk2 will automatically be handled on the next iteration.
        macroFieldsetNode.value = chunk1;
        macroFieldset.addAfter(macroFieldsetNode, chunk2);
        // We're done with this field, so let's advance the iterator
        macroFieldsetNode = macroFieldsetNode.next;
      } else {
        // Case 3: We can't split this field, and there's no way we're going
        // to fit any of it in the current chunk Cube.
        // Any space left in this chunk Cube will be wasted and we're going
        // to roll over to the next chunk.
        // First update our accounting...
        spaceRemaining -= cube.fields.bytesRemaining(options.maxChunkSize(chunkIndex));
        // ... and then it's time for a chunk rollover!
        cube = veritum.family.cubeClass.Create(veritum.cubeType, options) as cciCube;
        cubes.push(cube);
        chunkIndex++;
        bytesAvailableThisChunk =
          demoFieldset.bytesRemaining(options.maxChunkSize(chunkIndex));
        // Note that we have not handled this field!
        // We therefore must not advance the iterator.
      }
    }

    // Chunking done. Now fill in the CONTINUED_IN references.
    // This will also compile all chunk Cubes but the first one.
    // If a chunk transformation callback was specified (e.g. encryption),
    // call it right before compiling each Cube.
    if (Settings.RUNTIME_ASSERTIONS && (refs.length !== (cubes.length-1))) {
      throw new CubeError("Continuation.SplitCube: I messed up my chunking. This should never happen.");
    }
    for (let i=0; i<refs.length; i++) {
      // the first relationship field needs to reference the second Cube, and so on
      const referredCube = cubes[i+1];
      // we will go ahead and compile the referred Cube -- if there's a chunk
      // transformation callback, call it now
      if (options.chunkTransformationCallback !== undefined) {
        options.chunkTransformationCallback(referredCube,
          { chunkIndex: i+1, chunkCount: refs.length }
        );
      }
      const referredKey: CubeKey = await referredCube.getKey();  // compiles the Cube
      const correctRef: cciRelationship =
        new cciRelationship(cciRelationshipType.CONTINUED_IN, referredKey);
      const compiledRef: cciField = cciField.RelatesTo(correctRef);
      // fill in the correct ref value to the field we created at the beginning
      refs[i].value = compiledRef.value;
    }
    // Compile first chunk Cube for consistency.
    // Of course, also call the chunk transformation callback if there's one.
    if (options.chunkTransformationCallback !== undefined) {
      options.chunkTransformationCallback(cubes[0],
        { chunkIndex: 0, chunkCount: refs.length }
      );
    }
    await cubes[0].compile();

    return cubes;
  }


  static Recombine(
    cubes: Iterable<Cube>,
    options: RecombineOptions = {},
  ): Veritum {
    // set default options
    options.exclude ??= Continuation.ContinuationDefaultExclusions;

    // prepare variables
    let veritum: Veritum;  // will be initialized late below

    // iterate through all chunk Cubes...
    for (const cube of cubes) {
      if (veritum === undefined) {
        // late initialisation of macroCube because we base the type of Cube
        // on the first chunk supplied -- and as we accept an iterable we need
        // to be iterating to be able to look at it
        veritum = new Veritum(cube.cubeType, options);
      }

      for (const field of cube.fields.all) {
        // ... and look at each field:
        // - Excluded fields will be dropped, except PADDING which separates
        //   non-rejoinable adjacent fields
        if (field.type !== cciFieldType.PADDING &&
            options.exclude.includes(field.type)) continue;
        // - CONTINUED_IN references will be dropped
        if (field.type === cciFieldType.RELATES_TO) {
          const rel = cciRelationship.fromField(field);
          if (rel.type === cciRelationshipType.CONTINUED_IN) continue;
        }
        // - variable length fields of same type directly adjacent to each
        //   other will be merged
        const previousField: cciField =
          veritum.fieldCount > 0 ?
            // TODO: get rid of unsafe manipulateFields() call
            veritum.manipulateFields().all[veritum.fieldCount-1] :
            undefined;
        if (previousField !== undefined && field.type === previousField.type &&
            veritum.fieldParser.fieldDef.fieldLengths[field.type] === undefined) {
          previousField.value = Buffer.concat([previousField.value, field.value]);
          continue;
        }
        // - the rest will just be copied to the macro fieldset
        veritum.appendField(field);
      }
    }
    // in a second pass, remove any PADDING fields
    for (let i=0; i<veritum.fieldCount; i++) {
      // TODO: get rid of unsafe manipulateFields() calls
      if (veritum.manipulateFields().all[i].type === cciFieldType.PADDING) {
        veritum.manipulateFields().all.splice(i, 1);
        i--;
      }
    }
    return veritum;
  }
}
