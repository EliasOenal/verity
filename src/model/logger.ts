import { isBrowser, isNode, isWebWorker, isJsDom, isDeno } from "browser-or-node";
export var logger: any = undefined;

if (isNode) {
  const pino = require('pino')
  const pretty = require('pino-pretty')
  const stream = pretty({
    colorize: true,
    colorizeObjects: true,
    append: true,
  })
  logger = pino({ level: 'trace' }, stream)
} else {
  class DummyLogger {
    private loglevel: number = 5;

    public trace(message: String) {
      if (this.loglevel >= 5) {
        console.debug(message);
      }
    }

    public debug(message: String) {
      if (this.loglevel >= 4) {
        console.debug(message);
      }
    }

    public info(message: String) {
      if (this.loglevel >= 3) {
        console.info(message);
      }
    }

    public warn(message: String) {
      if (this.loglevel >= 2) {
        console.warn(message);
      }
    }

    public error(message: String) {
      if (this.loglevel >= 1) {
        console.error(message);
      }
    }
  }
  logger = new DummyLogger();
}