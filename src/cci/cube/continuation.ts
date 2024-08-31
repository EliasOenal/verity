import { Cube, CubeOptions } from "../../core/cube/cube";
import { CubeFamilyDefinition } from "../../core/cube/cubeFields";
import { NetConstants } from "../../core/networking/networkDefinitions";
import { ApiMisuseError, Settings } from "../../core/settings";
import { cciCube } from "./cciCube";
import { cciFieldType } from "./cciCube.definitions";
import { cciField } from "./cciField";

import { Buffer } from 'buffer'
import { cciFields } from "./cciFields";
import { cciRelationship, cciRelationshipType } from "./cciRelationship";
import { FieldParser } from "../../core/fields/fieldParser";
import { CubeError, CubeKey } from "../../core/cube/cube.definitions";

/**
 * Don't split fields if a resulting chunk would be smaller than this amount
 * of bytes. Don't set this to anything less than a minimal variable length
 * field (3) or things will break horribly!
 **/
const MIN_CHUNK = 10;

export function split(buf: Buffer, max: number): Buffer[] {
  const chunks: Buffer[] = [];
  for (let i = 0; i < buf.length; i += max) {
    chunks.push(buf.subarray(i, i + max));
  }
  return chunks;
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
   * @param macroCube An overly large Cube
   * @param options
   * @returns An array of chunk Cubes
   */
  static async Split(
      macroCube: Cube,
      options: CubeOptions&{ exclude?: number[], cubeSize?: number } = {},
  ): Promise<cciCube[]> {
    // set default options
    options.exclude ??= Continuation.ContinuationDefaultExclusions;
    options.cubeSize ??= NetConstants.CUBE_SIZE;

    // Pre-process the macro fieldset supplied:
    const macroFieldset: cciFields = new cciFields([], macroCube.fieldParser.fieldDef);
    let previousField: cciField = undefined;
    for (const field of macroCube.fields.all) {
      // - Only accept non-excluded fields from supplied macro Cube, i.e. everything
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
            macroCube.fieldParser.fieldDef.fieldLengths[field.type] === undefined)
        {
          const padding = new cciField(cciFieldType.PADDING, Buffer.alloc(0));
          macroFieldset.appendField(padding);
        }

        // now finally accept this field into our macro fieldset
        macroFieldset.appendField(field);  // maybe TODO: use less array copying operations
        previousField = field;
      }
    }

    // Precalculate some numbers that we'll later need to determine how many
    // Cubes we need.
    const demoFieldset: cciFields =
      cciFields.DefaultPositionals(macroCube.fieldParser.fieldDef) as cciFields;
    const bytesAvailablePerCube: number = demoFieldset.bytesRemaining(options.cubeSize);

    // Split the macro fieldset into Cubes:
    // prepare the list of Cubes and initialise the first one
    const cubes: cciCube[] = [ macroCube.family.cubeClass.Create(macroCube.cubeType, options) as cciCube ];
    let cube: cciCube = cubes[0];
    // Also prepare a list of CONTINUED_IN references to be filled in later.
    // Note the number of CONTINUED_IN references will always be one less than
    // the number of Cubes.
    const refs: cciField[] = [];

    let spaceRemaining = bytesAvailablePerCube;  // we start with just one chunk
    let minBytesRequred = macroFieldset.getByteLength();

    // Iterate over the macro fieldset
    for (let i=0; i<macroFieldset.all.length; i++) {
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
      const addRefs: cciField[] = [];
      while (spaceRemaining < minBytesRequred) {
        // add another CONTINUED_IN reference, i.e. plan for an extra Cube
        const rel: cciRelationship = new cciRelationship(
          cciRelationshipType.CONTINUED_IN, Buffer.alloc(
            NetConstants.CUBE_KEY_SIZE, 0));  // dummy key for now
        const refField: cciField = cciField.RelatesTo(rel);
        // remember this ref as a planned Cube...
        refs.push(refField);
        // ... and plan to add it to our field list, as obviously the reference needs
        // to be written
        addRefs.push(refField);
        // account for the space we gained by planning for an extra Cube
        // as well as the space we lost due to the extra reference
        spaceRemaining += bytesAvailablePerCube;
        minBytesRequred += macroFieldset.getByteLength(refField);
      }
      // insert the planned CONTINUED_IN references
      macroFieldset.all.splice(i, 0, ...addRefs);

      const field: cciField = macroFieldset.all[i];
      // If the next field entirely fits in the current cube, just insert it
      // and be done with it
      if (cube.fields.bytesRemaining(options.cubeSize) >= cube.fields.getByteLength(field)) {
        cube.fields.insertFieldBeforeBackPositionals(field);
        spaceRemaining -= cube.fields.getByteLength(field);
        minBytesRequred -= cube.fields.getByteLength(field);
        continue;
      }

      // Field doesn't fit? Let's get to work then!
      // First we need to find out if we're even going to split this field
      // or if we'll just roll it over to the next Cube in its entirety.
      // Two conditions must be satisfied to split:
      // - The remaining space in the Cube must be at least our arbitrarily
      //   decided minimum chunk size.
      // - The field must be variable length as fixed length field cannot be
      //   split (it would break the parser).
      const bytesRemaining = cube.fields.bytesRemaining(options.cubeSize);
      if (bytesRemaining >= MIN_CHUNK &&
          macroCube.fieldParser.fieldDef.fieldLengths[field.type] === undefined) {
        // Let's do some splitting!
        // Determine the exact location of the split point:
        const headerSize = FieldParser.getFieldHeaderLength(
          field.type, macroCube.fieldParser.fieldDef);
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
        cube.fields.insertFieldBeforeBackPositionals(chunk1);
        // Update our accounting:
        // Space remaining is reduced by the size of the first chunk; but
        // minBytesRequired is only reduces by the amount of payload actually
        // placed in chunk1. Splitting wastes space!
        spaceRemaining -= cube.fields.getByteLength(chunk1);
        minBytesRequred -= chunk1.value.length;
        // Replace the field on our macro fieldset with the two chunks;
        // this way, chunk2 will automatically be handled on the next iteration.
        macroFieldset.all.splice(i, 1, chunk1, chunk2);
      } else {
        // could not place field, need to revisit it in the next iteration
        i--;
      }

      // If we arrive here, there's nothing more we can do to cram more data
      // into the current chunk Cube.
      // Update our accounting: Any space left in the current Cube is wasted.
      spaceRemaining -= cube.fields.bytesRemaining(options.cubeSize);
      // Time for a chunk rollover!
      cube = macroCube.family.cubeClass.Create(macroCube.cubeType, options) as cciCube;
      cubes.push(cube);
      // That's all for now, see you on the next iteration where we will start
      // filling up this freshly sculpted chunk Cube :)
    }

    // Chunking done. Now fill in the CONTINUED_IN references
    if (Settings.RUNTIME_ASSERTIONS && (refs.length !== (cubes.length-1))) {
      throw new CubeError("Continuation.SplitCube: I messed up my chunking. This should never happen.");
    }
    for (let i=0; i<refs.length; i++) {
      // the first relationship field needs to reference the second Cube, and so on
      const referredCube: CubeKey = await cubes[i+1].getKey();
      const correctRef: cciRelationship =
        new cciRelationship(cciRelationshipType.CONTINUED_IN, referredCube);
      const compiledRef: cciField = cciField.RelatesTo(correctRef);
      // fill in the correct ref value to the field we created at the beginning
      refs[i].value = compiledRef.value;
    }

    return cubes;
  }


  static Recombine(
    cubes: Iterable<Cube>,
    options: CubeOptions&{ exclude?: number[], cubeSize?: number } = {},
  ): cciCube {
    // set default options
    options.exclude ??= Continuation.ContinuationDefaultExclusions;
    options.cubeSize ??= NetConstants.CUBE_SIZE;

    // prepare variables
    let macroCube: cciCube;  // will be initialized late below

    // iterate through all chunk Cubes...
    for (const cube of cubes) {
      if (macroCube === undefined) {
        // late initialisation of macroCube because we base the type of Cube
        // on the first chunk supplied -- and as we accept an iterable we need
        // to be iterating to be able to look at it
        macroCube = new cube.family.cubeClass(cube.cubeType, options) as cciCube;
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
          macroCube.fields.all.length > 0 ?
            macroCube.fields.all[macroCube.fields.all.length-1] :
            undefined;
        if (previousField !== undefined && field.type === previousField.type &&
            macroCube.fieldParser.fieldDef.fieldLengths[field.type] === undefined) {
          previousField.value = Buffer.concat([previousField.value, field.value]);
          continue;
        }
        // - the rest will just be copied to the macro fieldset
        macroCube.fields.appendField(field);
      }
    }
    // in a second pass, remove any PADDING fields
    for (let i=0; i<macroCube.fields.all.length; i++) {
      if (macroCube.fields.all[i].type === cciFieldType.PADDING) {
        macroCube.fields.all.splice(i, 1);
        i--;
      }
    }
    return macroCube;
  }
}