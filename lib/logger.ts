import { isEnvVar } from './utils';
import { LoggerOptions } from 'pino';

export const DEFAULT_LOGGER_OPTIONS: LoggerOptions = {
  level: process.env.LOGGER_LEVEL != null ? process.env.LOGGER_LEVEL : 'info',
  ...(isEnvVar(process.env.LOGGER_PRETTY) && {
    prettyPrint: {
      ignore: 'pid,hostname',
      translateTime: 'SYS:standard',
      // @ts-ignore
      singleLine: true,
    },
  }),
};
