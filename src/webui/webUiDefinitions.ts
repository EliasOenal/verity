import { VerityError } from "../core/settings";

export class UiError extends VerityError { name = "UiError" }

/**
 * Optional interface which controllers can accept as options to navigational
 * methods, i.e. methods building a view.
 */
export interface NavOptions {
  /**
   * To be used by async navigational methods.
   * If set to `true`, the method will wait for all async operations pertaining
   * to building the view before returning.
   * This should usually be unset (or set to false) for productive use as we
   * try to provide the user with a view immediately (to ensure low latency
   * for a good user experience) with that view then auto-updating once additional
   * data becomes available. For testing however, this can be set to true
   * so the test can assert the view is correct once it finished building.
   * @default false
   **/
  awaitAllOps?: boolean;
}
