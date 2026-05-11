const pino = require('pino');
const { env } = require('../config');

const isProd = env.nodeEnv === 'production';

const logger = pino({
  level: env.logLevel,
  base: { app: 'strong-marketing-agent' },
  ...(isProd
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname,app'
          }
        }
      })
});

module.exports = logger;
