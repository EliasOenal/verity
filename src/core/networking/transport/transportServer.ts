import { VerityError } from "../../settings";
import { NetworkTransport } from "./networkTransport";

import { EventEmitter } from 'events';

/**
 * @emits "incomingConnection": TransportConnection
 **/
export abstract class TransportServer extends EventEmitter {
  constructor(
      protected transport: NetworkTransport,
  ){
    super();
  }

  start(): Promise<void> {
    throw new VerityError("NetworkServer.start() to be implemented by subclass");
  }

  shutdown(): Promise<void> {
    throw new VerityError("NetworkServer.shutdown() to be implemented by subclass");
  }

  toString(): string {
    throw new VerityError("NetworkServer.toString() to be implemented by subclass");
  }

  toLongString(): string {
    throw new VerityError("NetworkServer.toLongString() to be implemented by subclass");
  }
}





