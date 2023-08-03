const pino = require('pino')
const pretty = require('pino-pretty')
const stream = pretty({
  colorize: true,
  colorizeObjects: true,
  append: true,
})
export const logger = pino({ level: 'trace' }, stream)