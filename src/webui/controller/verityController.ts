import { VerityView } from "../view/verityView";

/** Abstract base class for our controllers */
export abstract class VerityController {
  public contentAreaView: VerityView = undefined;

  /**
   * Permanently get rid of this controller.
   * Controllers must not be reused after shutdown; instead a new instance must
   * be created if needed.
   **/
  // Subclasses should override this and add additional cleanup code
  // if necessary.
  shutdown(): Promise<void> {
    if (this.contentAreaView) this.contentAreaView.shutdown();
    // Return a resolved promise
    return new Promise<void>(resolve => resolve());
  }

  /**
   * Closes this controller, but allows it to remain active in the
   * background if this particular type of controller supports it.
   **/
  // Subclasses should override this and add additional cleanup code
  // if necessary.
  close(): Promise<void> {
    if (this.contentAreaView) this.contentAreaView.unshow();
    // Return a resolved promise
    return new Promise<void>(resolve => resolve());
  }
}
