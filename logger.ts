import { pino, Logger} from 'pino'
export const logger: Logger = pino({
  transport: {
    target: 'pino-pretty',
    colorize: true,
    colorizeObjects: true,
    append: true,
  }
})