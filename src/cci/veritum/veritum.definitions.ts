import type { CubeCreateOptions } from "../../core/cube/cube.definitions";

import type { cciCube } from "../cube/cciCube";
import type { CciDecryptionParams, CciEncryptionParams } from "./encryption.definitions";
import type { VerityField } from "../cube/verityField";

import type { DoublyLinkedListNode } from "./doublyLinkedList";

import { FieldType } from "../cube/cciCube.definitions";

export interface VeritumCreateOptions extends VeritumCompileOptions {
  /**
   * You should never need to supply this manually; if you do, make sure you
   * know what your're doing.
   * This parameter is used when reconstructing a Veritum from a list of chunks
   * to supply that list here, so that the resulting Veritum is already in
   * compiled state.
   */
  chunks?: cciCube[];
}

export enum RetrievalFormat {
  Cube,
  Veritum
}

export interface VeritumCompileOptions extends CubeCreateOptions, CciEncryptionParams {
}

export interface VeritumFromChunksOptions extends RecombineOptions, CciDecryptionParams {
}

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
  // TODO BUGBUG these are not really CubeOptions; I can't define fields here.
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
  excludeField?: number[];

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

/**
 * Exposes the internal state of the chunk splitter when splitting a Veritum.
 * This is used for optional callbacks during splitting, which in turn is
 * used e.g. for Veritum encryption.
 */
export interface SplitState {
  spaceRemaining: number;
  macroFieldsetNode: DoublyLinkedListNode<VerityField>;
}

/**
 * Exposes the internal state of the chunk splitter while finalising a split,
 * i.e. while compiling each chunk.
 * This is used for optional callbacks during finalisation, which in turn is
 * used e.g. for Veritum encryption.
 */
export interface ChunkFinalisationState {
  chunkIndex: number;
  chunkCount: number;
}

/**
 * The default set of fields to exclude from splitting.
 * Those include all core/positional fields, non-CCI fields, virtual fields
 * as well as the CCI end marker and padding fields.
 * Overriding this will probably only make sense for advanced users using their
 * own parsing/family settings, and even then you will probably want to make
 * sure all fields listed here are also excluded in your custom exclude list.
 */
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
