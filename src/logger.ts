import { isEnvVar } from './utils';
import { LoggerOptions as LoggerOptionsBase } from 'pino';

export const loggerLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;
export type LoggerLevel = typeof loggerLevels[number];

export interface LoggerOptions extends Omit<LoggerOptionsBase, 'level'> {
  level: LoggerLevel;
}

export function isLoggerLevel(arg?: string): arg is LoggerLevel {
  return arg != null && loggerLevels.includes(arg as LoggerLevel);
}

export const DEFAULT_LOGGER_OPTIONS: LoggerOptions = {
  level: isLoggerLevel(process.env.LOGGER_LEVEL) ? process.env.LOGGER_LEVEL : 'debug',
};
