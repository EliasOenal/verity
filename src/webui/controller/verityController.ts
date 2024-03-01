/** Abstract base class for our controllers */
export abstract class VerityController {
  shutdown(): Promise<void> {
    // Return a resolved promise
    return new Promise<void>(resolve => resolve());
  }
}
