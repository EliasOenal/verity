/**
 * This is IdentityUtil, a loose collection of functions related to
 * high-level Identity stuff.
 * Note there is two Identity-related function collections:
 *   - IdentityHelpers for low-level stuff. The important bit here is that these
 *     helpers may be used by Identity itself; IdentityHelpers should never
 *     import Identity to avoid circular dependencies.
 *   - IdentityUtil for high-level stuff, usually function which itself import
 *     Identity.
 */

import type { CubeKey } from "../../core/cube/coreCube.definitions";

import { CancellableTask } from "../helpers";
import { keyVariants, asCubeKey } from "../../core/cube/keyUtil";
import { CancellableGenerator, eventsToGenerator } from "../../core/helpers/asyncGenerators";

import { Identity } from "./identity";

/**
 * Verifies if a post claimed to be by a specific author is indeed by that author.
 * This is done by blocking until the author's Identity object learns about the
 * post.
 * @returns {CancellableTask} A boolean Promise wrapped as a CancellableTask.
 *   Note that this promise can only ever resolve to true as there is no way
 *   of definitely falsifying an authorship claim; we can either confirm it
 *   or simply don't know.
 *   The caller can and should cancel the task if it is no longer needed.
 **/
export function verifyAuthorship(
  postKeyInput: CubeKey|string,
  author: Identity,
): CancellableTask<boolean> {
  // first handle the trivial case:
  // check if the author's Identity object already refers to the post
  if(author.hasPost(postKeyInput)) return new CancellableTask(Promise.resolve(true));

  // if it does not, we'll block until the Identity object learns about the post;
  // note that this is potentially forever
  const task = new CancellableTask<boolean>();
  const postKey: CubeKey = asCubeKey(keyVariants(postKeyInput).binaryKey);
  const confirmationGen: CancellableGenerator<CubeKey> = eventsToGenerator(
    [{ emitter: author, event: 'postKeyAdded' }]);
  const awaiting = async () => {
    for await (const candidateKey of confirmationGen) {
      if (candidateKey.equals(postKey)) {
        // yay, it's confirmed!
        task.resolve(true);  // resolve to true
        confirmationGen.cancel();  // no need for more than one confirmation
        return;  // we're done
      }
    }
  };
  awaiting().then(() => {
    // Resolve the underlying promise to undefined just in case;
    // if we're done because confirmation was already received then the promise
    // has already resolved to true and the following line will have no effect.
    task.resolve(undefined);
  });
  return task;
}
