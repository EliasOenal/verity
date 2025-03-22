import { TransportServer } from "../transport/transportServer";

export class DummyTransportServer extends TransportServer {
  start(): Promise<void> {
    // Okay, I'm totally ready
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    // Yeah sure, I will properly shut down for you
    return Promise.resolve();
  }

  toString(): string {
    return "DummyTransportServer";
  }

  toLongString(): string {
    return "a really great DummyTransportServer";
  }
}
