import { isBrowser, isNode } from "browser-or-node";

/**
 * If we're not using Pino (e.g. in the Browser environment), we will use this
 * somewhat Pino-compatible dummy logger class to just write to console.
 */
class DummyLogger {
  private loglevel: number = 5;

  public trace(message: string) { if (this.loglevel >= 5) console.debug(message); }
  public debug(message: string) { if (this.loglevel >= 4) console.debug(message); }
  public info(message: string)  { if (this.loglevel >= 3) console.info(message); }
  public warn(message: string)  { if (this.loglevel >= 2) console.warn(message); }
  public error(message: string) { if (this.loglevel >= 1) console.error(message); }
}

// Logger is always set to a DummyLogger instance; later replaced with pino-compatible logger in Node.
export let logger: DummyLogger = new DummyLogger();


if (isNode) {
  const pino = (await import('pino')).default;
  const pretty = (await import('pino-pretty')).default;
  const stream = pretty({
    colorize: true,
    colorizeObjects: true,
    append: true,
  })
  logger = pino({ level: 'trace' }, stream) as unknown as DummyLogger;  // HACKHACK
}