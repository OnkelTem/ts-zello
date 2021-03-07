// Global
import WebSocket from 'ws';
import { Readable, Writable } from 'stream';
import pEvent from 'p-event';
import pino, { Logger, LoggerOptions } from 'pino';

// Project
import { getOpusReader, OpusReader, TranscodingOptions } from './opus-stream';
import * as Api from './api';
import { delay, getTime, packPacket, toCamel, unpackPacket } from './utils';
import { encodeCodecHeader } from './utils';
import { CommandLogonRequest } from './api';

//
// Const
//

const ZELLO_PUBLIC_SERVER = 'wss://zello.io/ws';
const DEFAULT_RETRY_STRATEGY: RetryStrategy = {
  during: 0,
  retries: 0,
  delay: 3,
};

const DEFAULT_OPTIONS: Options = {
  logger: {
    level: 'info',
  },
  name: 'bot',
};

//
// Types
//

export const customEventNames = ['onStreamStartAudio'] as const;
export type CustomEventName = typeof customEventNames[number];
export const customEventCodes = ['on_stream_start_audio'] as const;
export type CustomEventCode = typeof customEventCodes[number];

export interface CustomEventStreamStartAudio {
  event: Api.EventStreamStart;
  stream: Readable;
}

export interface CustomEventMap {
  onStreamStartAudio: CustomEventStreamStartAudio;
}

// Joining API and custom events
type EventMap = Api.EventMap & CustomEventMap;
type EventName = Api.EventName | CustomEventName;

//
// Events
//

type EventCallback<T extends EventName> = (data: EventMap[T]) => void;
type EventCallbacks = {
  [P in EventName]?: EventCallback<P>;
};
type Event<T extends EventName> = (cb: EventCallback<T>) => void;
type Events = {
  readonly [P in EventName]: Event<P>;
};

//
// Awaits
//

type AwaitFilterCallback<T extends EventName> = (data: EventMap[T]) => boolean;
type Await<T extends EventName> = (filter: AwaitFilterCallback<T>, timeout: number) => Promise<EventMap[T] | undefined>;
type Awaits = {
  readonly [P in EventName]: Await<P>;
};

//
// Commands
//

type CommandName = Api.CommandName;
type CommandMap = Api.CommandMap;
type Command<T extends CommandName> = (request: CommandMap[T][0]) => Promise<CommandMap[T][1]>;
type Commands = {
  readonly [P in CommandName]: Command<P>;
};

//
// Macros
//

type RetryStrategy = {
  during: number;
  retries: number;
  delay: number;
};

type SendAudioOptions = {
  retry?: Partial<RetryStrategy>;
  transcode?: TranscodingOptions;
};

export interface Macros {
  // readonly receiveAudio: (cb: (arg: any) => void) => Promise<void>;
  readonly login: (cred: Omit<CommandLogonRequest, 'command'>) => Promise<void>;
  readonly sendAudio: (stream: Readable, options?: SendAudioOptions) => Promise<void>;
}

//
// Script
//

export interface ScriptProps {
  readonly ctl: Ctl;
  readonly events: Events;
  readonly commands: Commands;
  readonly macros: Macros;
  readonly awaits: Awaits;
  readonly logger: Logger;
}

export type Script<TReturn> = (props: ScriptProps) => Generator<Promise<any>, TReturn, any>;

function isScript(arg: any): arg is Script<unknown> {
  return arg != null && typeof arg === 'function';
}

export interface Ctl {
  readonly close: () => Promise<void>;
  readonly status: () => Api.WsState;
  readonly run: <R>(script: Script<R>) => Promise<R>;
}

type Options = {
  logger: LoggerOptions;
  name: string;
};

function isOptions(arg: any): arg is Options {
  return arg != null && typeof arg === 'object' && ((arg as Options).logger != null || (arg as Options).name != null);
}

type ServerAddress = string;

function isServerAddress(arg: any): arg is ServerAddress {
  return arg != null && typeof arg === 'string';
}

function isPromise(arg: any): arg is Promise<any> {
  return !!arg && typeof arg.then === 'function';
}

const botCounters = new Map<string, number>();

export async function zello<R>(address?: string, script?: Script<R>, options?: Partial<Options>): Promise<Ctl>;
export async function zello<R>(script?: Script<R>, options?: Partial<Options>): Promise<Ctl>;

export async function zello<R>(
  a?: string | Script<R>,
  b?: Script<R> | Partial<Options>,
  c?: Partial<Options>,
): Promise<Ctl> {
  const address = isServerAddress(a) ? a : ZELLO_PUBLIC_SERVER;
  const script = isScript(a) ? a : isScript(b) ? b : null;
  const options: Options = {
    ...DEFAULT_OPTIONS,
    ...(isOptions(b) ? b : isOptions(c) ? c : null),
  };
  const pinoLogger = pino(options.logger);

  // Get bot name
  if (!botCounters.has(options.name)) {
    botCounters.set(options.name, 0);
  }
  const counter = botCounters.get(options.name)!;
  let name = counter > 0 ? options.name + '-' + counter : options.name;
  botCounters.set(options.name, counter + 1);

  pinoLogger.info(`Assigning name "${name}" to the bot`);

  const logger = pinoLogger.child({ bot: name });
  let closeRequested = false;

  type DeferredPromise = {
    resolve: any;
    reject?: any;
  };

  let deferredClosePromise: DeferredPromise = {
    resolve: null,
  };
  const closePromise = new Promise<void>(function (resolve) {
    deferredClosePromise = { resolve };
  });
  let loggedIn = false;
  let deferredLogonPromise: DeferredPromise = {
    resolve: null,
  };
  const logonPromise = new Promise<Api.EventChannelStatus>(function (resolve) {
    deferredLogonPromise = { resolve };
  });

  logger.info('Starting Zello');

  try {
    const ws = await new Promise<WebSocket>(function (resolve, reject) {
      try {
        logger.debug(`Connecting to: ${address}`);
        let ws = new WebSocket(address);
        ws.addEventListener(
          'open',
          () => {
            logger.info(`Connected to: ${address}!`);
            resolve(ws);
          },
          { once: true },
        );
        ws.addEventListener(
          'error',
          (err) => {
            logger.error('Connection error');
            logger.debug(err, 'Connection error');
            reject(err);
          },
          { once: true },
        );
      } catch (err) {
        reject(err);
      }
    });

    let deferredExceptionPromise: DeferredPromise = {
      resolve: null,
    };
    const exceptionPromise = new Promise<Error>(function (resolve) {
      deferredExceptionPromise = { resolve };
    });

    ws.addEventListener('error', (err) => {
      logger.error('Socket error');
      logger.debug(err);
      const exception = new Error(`Unexpected websocket error: ${err.message}`);
      deferredExceptionPromise.resolve(exception);
    });

    ws.addEventListener('close', (event) => {
      if (closeRequested) {
        logger.info('Closing socket (normal)');
      } else {
        logger.warn('Closing socket (emergency)');
      }
      deferredClosePromise.resolve();
      if (!closeRequested) {
        const exception = new Error(`Unexpected close, code: ${event.code}, reason: ${event.reason}`);
        deferredExceptionPromise.resolve(exception);
      }
    });

    let seq: number = 0;
    let seqReservedCount: number = 0;

    const commandPromises = new Map<number, { command: Api.CommandCode; promise: DeferredPromise }>();

    function command<T extends CommandName>(request: Api.CommandMap[T][0]): Promise<Api.CommandMap[T][1]> {
      logger.debug(`Running command: ${request.command}`);
      logger.trace(request, 'Command request');
      seqReservedCount++;
      const seqCurrent = seq + seqReservedCount;
      const promise = new Promise<Api.CommandMap[T][1]>(function (resolve, reject) {
        commandPromises.set(seqCurrent, { command: request.command, promise: { resolve, reject } });
      });
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            ...request,
            seq: seqCurrent,
          }),
          (err) => {
            if (err == null) {
              seq = seqCurrent;
            } else {
              if (commandPromises.has(seqCurrent)) {
                const commandPromise = commandPromises.get(seqCurrent)!;
                commandPromises.delete(seqCurrent);
                commandPromise.promise.reject(err);
              }
            }
          },
        );
      } else {
        const msg = `Cannot send command: socket state is ${Api.webSocketStateNames[ws.readyState]}`;
        logger.warn(msg);
        // Cannot send command, reject and remove it immediately
        const commandPromise = commandPromises.get(seqCurrent)!;
        commandPromises.delete(seqCurrent);
        commandPromise.promise.reject(new Error(msg));
      }
      return promise;
    }

    let callbacks: EventCallbacks;
    const expectedAudioStreams = new Map<number, Readable>();
    // const expectedImageStreams = new Map<number, EventStreamStart>();

    ws.addEventListener('message', ({ type, data }) => {
      logger.debug('Received message');
      logger.trace({ type, data }, 'Message details');
      if (ws.readyState === WebSocket.OPEN) {
        if (type === 'message') {
          if (typeof data === 'string') {
            const json = JSON.parse(data);
            if (Api.isCommandResponse(json)) {
              //
              // Command response
              //
              logger.debug(`Message is command response, seq = ${seq}`);
              if (commandPromises.has(json.seq)) {
                const commandPromise = commandPromises.get(json.seq)!;
                logger.debug(`Found original command: ${commandPromise.command}`);
                commandPromises.delete(json.seq);
                commandPromise.promise.resolve(json);
              }
            } else if (Api.isEvent(json)) {
              //
              // Event
              //
              const eventCode = json.command;
              logger.debug(`Message is event: ${eventCode}`);
              const callback = callbacks[toCamel(eventCode) as Api.EventName];
              if (callback != null) {
                logger.debug(`Running callback`);
                callback(json as any);
              }
              // Special case for audio stream starts
              if (Api.isEventStreamStart(json)) {
                // Check if we have a callback for it
                const callback = callbacks['onStreamStartAudio'];
                if (callback != null) {
                  logger.debug('Found audio stream callback, creating audio stream');
                  // Create audio stream
                  const stream = new Readable({
                    read: () => {},
                  });
                  expectedAudioStreams.set(json.stream_id, stream);
                  // callback({ event: json, stream });
                  callback({ event: json, stream });
                }
              }
              // Special case for errors
              if (Api.isEventError(json)) {
                // We should reject all deferred commands
                for (const key of commandPromises.keys()) {
                  const commandPromise = commandPromises.get(key)!;
                  logger.debug(`Cancelling command: ${commandPromise.command}`);
                  commandPromises.delete(key);
                  commandPromise.promise.reject(new Error(json.error));
                }
              }
              // Special case for login command
              if (Api.isEventChannelStatus(json) && !loggedIn) {
                logger.debug('Finalizing logging in');
                loggedIn = true;
                deferredLogonPromise.resolve(json);
              }
            } else {
              logger.warn(json, 'Unknown message');
            }
          } else if (typeof data === 'object' && Buffer.isBuffer(data)) {
            logger.debug(`Message is data packet of length ${data.length}`);
            logger.trace(data, 'Data packet');
            const packet = unpackPacket(data);
            if (packet != null) {
              if (Api.isPacketAudio(packet)) {
                if (expectedAudioStreams.has(packet.streamId)) {
                  const stream = expectedAudioStreams.get(packet.streamId)!;
                  stream.push(packet.data);
                }
              } else if (Api.isPacketImage(packet)) {
                logger.warn('Image receiving is not implemented');
              } else {
                logger.debug('Unknown packet');
              }
            } else {
              logger.warn('Empty packet');
            }
          } else {
            logger.warn('Unknown message data type');
          }
        } else {
          logger.warn('Type of message is not "message"');
        }
      } else {
        logger.warn('Received message while ws.readyState = ' + Api.webSocketStateNames[ws.readyState]);
      }
    });

    async function executeScript<R>(script: Script<R>): Promise<R> {
      logger.info('Executing user script');
      const gen = script(scriptProps);
      let param: any = undefined;
      let error: Error | undefined = undefined;
      let yieldCounter = 1;
      while (true) {
        let value: any;
        let done: boolean | undefined;
        logger.debug(`Executing yield ${yieldCounter} of the user script (${error == null ? 'normal' : 'error'})`);
        const obj = !error ? gen.next(param) : gen.throw(error);
        value = obj.value;
        done = obj.done;
        if (done) {
          logger.debug('Exiting user script');
          return value;
        }
        if (isPromise(value)) {
          let res: any;
          try {
            res = await Promise.race([value, exceptionPromise]);
          } catch (err) {
            logger.debug('User script promise rejected');
            res = err;
          }
          // noinspection SuspiciousTypeOfGuard
          if (res instanceof Error) {
            error = res;
          } else {
            param = res;
          }
        } else {
          logger.error(`User script must yield only promises, "${typeof value}" received`);
        }
      }
    }

    const ctl: Ctl = {
      close: () => {
        logger.debug('Ctl: requested socket close');
        ws.close();
        closeRequested = true;
        return closePromise;
      },
      status: () => {
        logger.debug('Ctl: requested status');
        return Api.webSocketStateNames[ws.readyState];
      },
      run: async (script) => {
        logger.debug('Ctl: requested user script execution');
        return await executeScript(script);
      },
    };

    function event<T extends EventName>(e: T, cb: EventCallback<T>) {
      //logger.debug(`Setting event callback: ${event}`);
      callbacks[e] = cb;
    }

    event('onTextMessage', (cb) => {
      console.log('123');
    });

    const events: Events = {
      onChannelStatus: (cb) => {},
      onTextMessage: (cb) => {
        logger.debug('Setting event callback: "onTextMessage"');
        callbacks['onTextMessage'] = cb;
      },
      onStreamStart: (cb) => {
        logger.debug('Setting event callback: "onStreamStart"');
        callbacks['onStreamStart'] = cb;
      },
      onError: (cb) => {
        logger.debug('Setting event callback: "onError"');
        callbacks['onError'] = cb;
      },
      onStreamStartAudio: (cb) => {
        logger.debug('Setting event callback: "onStreamStartAudio"');
        callbacks['onStreamStartAudio'] = cb;
      },
    };

    // const asd: Awaits[T] = function<T>(filter<T>, timeout) {
    //   logger.debug(`Setting event await: "onStreamStart"`);
    //   return await Promise.race([
    //     new Promise<EventStreamStart>((resolve) => {
    //       events.onStreamStart((event) => {
    //         if (filter != null && filter(event)) {
    //           resolve(event);
    //         }
    //       });
    //     }),
    //     delay(timeout),
    //   ]);
    // }

    const awaits = {
      onStreamStart: async (filter, timeout) => {
        logger.debug(`Setting event await: "onStreamStart"`);
        return await Promise.race([
          new Promise<EventStreamStart>((resolve) => {
            events.onStreamStart((event) => {
              if (filter != null && filter(event)) {
                resolve(event);
              }
            });
          }),
          delay(timeout),
        ]);
      },
      // TODO: remove after implementing the rest
    } as Awaits;

    const commands: Commands = {
      logon: async (request: Api.CommandLogonRequest) => {
        let resp: Api.CommandLogonResponse;
        try {
          resp = await command(Api.CommandNames.LOGON, request);
        } catch (err) {
          throw new Error(err);
        }
        if (resp.error != null) {
          throw new Error(resp.error);
        }
        const isAuthorized = resp.success != null && resp.success && resp.refresh_token != null;
        if (!isAuthorized) {
          throw new Error('authorization failed');
        }
        let channelStatus: Api.EventChannelStatus;
        try {
          channelStatus = await logonPromise;
        } catch (err) {
          throw new Error(err);
        }
        if (channelStatus.status !== 'online') {
          throw new Error('channel not available');
        }
        logger.info(`Successfully logged in to channel "${request.channel}"`);
      },
      sendTextMessage: async (request) => {
        try {
          await command(Api.CommandNames.SEND_TEXT_MESSAGE, request);
        } catch (err) {
          throw new Error(err);
        }
      },
      startStream: async (request) => {
        try {
          return await command(Api.CommandNames.START_STREAM, request);
        } catch (err) {
          throw new Error(err);
        }
      },
      stopStream: async (request) => {
        try {
          return await command(Api.CommandNames.STOP_STREAM, request);
        } catch (err) {
          throw new Error(err);
        }
      },
    };

    const macros: Macros = {
      sendAudio: async (inputStream, options) => {
        logger.info('Running macro: "sendAudio"');
        const retry: RetryStrategy = {
          ...DEFAULT_RETRY_STRATEGY,
          ...(options != null && options.retry),
        };
        const transcode = options != null ? options.transcode : null;
        let resp: Api.CommandStartStreamResponse;
        let opusReader: OpusReader;
        try {
          opusReader = await getOpusReader(inputStream, logger, transcode);
        } catch (err) {
          // Couldn't create OpusReader
          logger.error(err, 'Error creating OPUS reader');
          throw new Error(err);
        }
        const retryCounters = {
          attempt: 1,
          startAtMs: new Date().getTime(),
        };
        // Getting button
        while (true) {
          logger.info('Requesting the mic...');
          try {
            resp = await commands.startStream({
              type: Api.StreamTypes.AUDIO,
              codec: Api.Codecs.OPUS,
              codec_header: encodeCodecHeader(opusReader.opusInfo),
              packet_duration: opusReader.opusInfo.frameSize,
            });
          } catch (err) {
            throw new Error(err);
          }
          if (resp.error != null) {
            if (resp.error === Api.ErrorMessages.CHANNEL_BUSY) {
              logger.info('Channel busy');
              // Check retry conditions
              if (
                // Reached the number of attempts
                retryCounters.attempt >= retry.retries + 1 &&
                // Reached time limit
                new Date().getTime() - retryCounters.startAtMs >= retry.during * 1000
              ) {
                // Giving up
                throw new Error(resp.error);
              } else {
                // Retrying
                logger.info(`Idling for ${retry.delay} second(s)...`);
                await delay(retry.delay * 1000);
                retryCounters.attempt++;
                logger.debug(`Retrying, attempt: ${retryCounters.attempt}`);
                continue;
              }
            } else {
              logger.debug(`Start stream error: ${resp.error}`);
              // Unknown thing, maybe banned
              throw new Error(resp.error);
            }
          }
          // Successfully got the button
          break;
        }
        logger.info('Got the button!');

        let packetId = 0;
        let lastTime: bigint;

        const streamLogger = logger.child({ facility: 'serverStream' });

        // Create a writable stream
        const serverStream = new Writable({
          write: async function (packet: Buffer | undefined, encoding, callback) {
            if (packet) {
              streamLogger.trace(`Received packet: ${packetId}`);
              const zelloPacket = packPacket({
                data: packet,
                type: Api.PacketTypes.AUDIO,
                streamId: resp.stream_id,
                packetId: packetId++,
              });
              if (zelloPacket != null) {
                if (lastTime != null) {
                  // The timer has been started when sending previous packet.
                  // Measure in milliseconds the time passed since then.
                  const diff = Math.ceil(Number(getTime() - lastTime) / 1000000);
                  // Delay the rest milliseconds
                  await delay(opusReader.opusInfo.frameSize - diff);
                }
                await new Promise((resolve, reject) => {
                  ws.send(zelloPacket, { binary: true }, function (err) {
                    if (err) {
                      streamLogger.warn(`Cannot send packet: ${packetId}`);
                      reject(err);
                    } else {
                      resolve(true);
                    }
                  });
                });
                lastTime = getTime();
              }
            }
            callback();
          },
        });
        logger.info('Start streaming...');
        logger.debug(`stream_id: ${resp.stream_id}`);
        opusReader.opusStream.pipe(serverStream);
        await pEvent(serverStream, 'finish');
        // Closing stream
        await commands.stopStream({
          streamId: resp.stream_id,
        });
      },
    };

    const scriptProps: ScriptProps = {
      ctl,
      events,
      commands,
      macros,
      awaits,
      logger,
    };

    if (script) {
      await executeScript(script);
    }
    return ctl;
  } catch (err) {
    throw new Error(err.message);
  }
}
