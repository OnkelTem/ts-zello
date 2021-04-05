// Global
import WebSocket from 'ws';
import { Readable, Writable } from 'stream';
import pino from 'pino';
import { EventEmitter } from 'events';

// Project
import './config';
import * as Api from './api';
import * as Types from './types';
import { getMacros } from './macros';
import { webSocketStateNames } from './ws';
import { decodeCodecHeader, getTime, packPacket, unpackPacket } from './utils';
import delay from 'delay';
import { initAudioStream } from './audio';
import pEvent from 'p-event';
import { DEFAULT_LOGGER_OPTIONS } from './logger';

//
// Const
//

const ZELLO_PUBLIC_SERVER = 'wss://zello.io/ws';
const DEFAULT_COMMAND_TIMEOUT = process.env.COMMAND_TIMEOUT != null ? parseInt(process.env.COMMAND_TIMEOUT) : 10;

export const DEFAULT_ZELLO_OPTIONS: Types.Options = {
  logger: DEFAULT_LOGGER_OPTIONS,
  name: 'bot',
};

const botCounters = new Map<string, number>();

async function zello<R>(
  address?: string,
  script?: Types.Script<R>,
  options?: Partial<Types.Options>,
): Promise<Types.Zello>;
async function zello(address?: string, options?: Partial<Types.Options>): Promise<Types.Zello>;
async function zello<R>(script?: Types.Script<R>, options?: Partial<Types.Options>): Promise<Types.Zello>;
async function zello(options?: Partial<Types.Options>): Promise<Types.Zello>;

async function zello<R>(
  a?: string | Types.Script<R> | Partial<Types.Options>,
  b?: Types.Script<R> | Partial<Types.Options>,
  c?: Partial<Types.Options>,
): Promise<Types.Zello> {
  const address = Types.isServerAddress(a) ? a : ZELLO_PUBLIC_SERVER;
  const script = Types.isScript(a) ? a : Types.isScript(b) ? b : null;
  const options: Types.Options = {
    ...DEFAULT_ZELLO_OPTIONS,
    ...(Types.isOptions(a) ? a : Types.isOptions(b) ? b : Types.isOptions(c) ? c : null),
  };

  const pinoLogger = options.logger instanceof EventEmitter ? options.logger : pino(options.logger);

  // Get bot name
  if (!botCounters.has(options.name)) {
    botCounters.set(options.name, 0);
  }
  const counter = botCounters.get(options.name)!;
  const name = counter > 0 ? options.name + '-' + counter : options.name;
  botCounters.set(options.name, counter + 1);

  pinoLogger.info(`Assigning name "${name}" to the bot`);

  const logger = pinoLogger.child({ bot: name });
  let closeRequested = false;

  let deferredClosePromise: Types.DeferredPromise<void>;
  const closePromise = new Promise<void>((resolve) => {
    deferredClosePromise = { resolve };
  });

  logger.info('Starting Zello');

  let seq: number = 0;
  let seqReservedCount: number = 0;
  let ws: WebSocket;

  const commandPromises = new Map<number, { command: Types.CommandCode; promise: Types.DeferredPromise<any> }>();

  let deferredExceptionPromise: Types.DeferredPromise<Error>;
  const exceptionPromise = new Promise<Error>((resolve) => {
    deferredExceptionPromise = { resolve };
  });

  // TODO: Rewrite callbacks to be queued
  //       Currently they get easily overwritten
  const callbacks: Types.EventCallbacks = {};
  const expectedAudioStreams = new Map<number, Readable>();
  // const expectedImageStreams = new Map<number, EventStreamStart>();

  function runCommand<T extends Types.CommandCode>(
    commandCode: T,
    request: Omit<Types.CommandMap[T][0], 'command'>,
  ): Promise<Types.CommandMap[T][1]> {
    logger.debug(`Running command: ${commandCode}`);
    logger.trace(request, 'Command request');
    seqReservedCount++;
    const seqCurrent = seq + seqReservedCount;
    const promise = new Promise<Types.CommandMap[T][1]>(function (resolve, reject) {
      commandPromises.set(seqCurrent, { command: commandCode, promise: { resolve, reject } });
    });
    if (ws.readyState === WebSocket.OPEN) {
      if (Types.isCommandSendData(request, commandCode)) {
        // Special case for sendData command: create and return getDataStream
        // This promise resolves when send stream is created
        const commandPromise = commandPromises.get(seqCurrent)!;
        commandPromises.delete(seqCurrent);
        const streamInfo = setupDataStream(request);

        commandPromise.promise.resolve(streamInfo);
      } else {
        // Sending command via websocket
        //const startTime = getTime();
        ws.send(
          JSON.stringify({
            ...request,
            command: commandCode,
            seq: seqCurrent,
          }),
          (err) => {
            //logger.debug(`Command sent in ${Number(getTime() - startTime) / 1000} μs`);
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
      }
    } else {
      const msg = `Cannot send command: socket state is ${webSocketStateNames[ws.readyState]}`;
      logger.warn(msg);
      // Cannot send command, reject and remove it immediately
      const commandPromise = commandPromises.get(seqCurrent)!;
      commandPromises.delete(seqCurrent);
      commandPromise.promise.reject(new Error(msg));
    }
    return promise;
  }

  let outgoingDataStream: Writable | null = null;

  function setupDataStream(request: Types.CommandMap['send_data'][0]): Types.CommandMap['send_data'][1] {
    let packetId = 0;
    let lastTime: bigint;
    // Create a writable stream
    outgoingDataStream = new Writable({
      write: async function (packet: Buffer | undefined, encoding, callback) {
        if (packet) {
          logger.trace(`Received packet: ${packetId}`);
          const zelloPacket = packPacket({
            data: packet,
            type: Api.PacketTypes.AUDIO,
            streamId: request.streamId,
            packetId: packetId++,
          });
          if (zelloPacket != null) {
            if (lastTime != null) {
              // The timer has been started when sending previous packet.
              // Measure in milliseconds the time passed since then.
              const diff = Math.ceil(Number(getTime() - lastTime) / 1000000);
              // Delay the rest milliseconds
              logger.trace(`Will send packet ${packetId} after: ${request.frameSize - diff} ms `);
              await delay(request.frameSize - diff);
            }
            try {
              await new Promise((resolve, reject) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(zelloPacket, { binary: true }, function (err) {
                    if (err) {
                      logger.warn(`Cannot send packet: ${packetId}`);
                      reject(err);
                    } else {
                      resolve(true);
                    }
                  });
                } else {
                  reject(new Error('Socket is not open, cannot send data'));
                }
              });
            } catch (err) {
              callback(err);
              return;
            }
            lastTime = getTime();
          }
          callback();
          return;
        }
        callback(new Error('Cannot send: not a packet'));
      },
    });
    return {
      stream: outgoingDataStream,
    };
  }

  function stopDataStream() {
    if (outgoingDataStream != null) {
      logger.info('Stopping outgoing stream');
      outgoingDataStream.destroy();
      pEvent(outgoingDataStream, 'close').then(() => {
        outgoingDataStream = null;
      });
    }
  }

  async function executeScript<R>(script: Types.Script<R>, props: Types.Zello): Promise<R> {
    logger.info('Executing user script');
    const gen = script(props);
    // Check to see if our script is Generator or Promise
    if (Types.isScriptGenerator(gen)) {
      // It's not necessary to use this, but it allows to catch
      // async exceptions which otherwise would be missed.
      let param: any = undefined;
      let error: Error | undefined = undefined;
      const yieldCounter = 1;
      while (true) {
        logger.debug(`Executing yield ${yieldCounter} of the user script (${error == null ? 'normal' : 'error'})`);
        const obj = !error ? gen.next(param) : gen.throw(error);
        const value = obj.value;
        const done = obj.done;
        if (done) {
          logger.debug('Exiting user script');
          return value;
        }
        if (Types.isPromise(value)) {
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
    } else {
      // It's a Promise most likely or just anything
      return gen;
    }
  }

  function setEventHandler<T extends Types.EventCode>(eventCode: T): Types.Event<T> {
    return function (cb) {
      logger.debug(`Setting event callback: ${eventCode}`);
      // @ts-ignore
      callbacks[eventCode] = cb;
    };
  }

  function setAwaitHandler<T extends Types.EventName>(eventName: T): Types.Await<T> {
    return async function (filter, timeout) {
      logger.debug(`Running await "${eventName}" with timeout ${timeout} seconds`);
      const delayPromise = delay(timeout * 1000);
      const res = await Promise.race([
        new Promise<Types.EventMap[Types.EventNameToCode[T]]>((resolve) => {
          // @@ts-ignore
          const event = events[eventName] as Types.Event<Types.EventNameToCode[T]>;
          event((event) => {
            if ((typeof filter === 'function' && filter(event)) || filter) {
              resolve(event);
            }
          });
        }),
        exceptionPromise,
        delayPromise,
      ]);
      if (res != null) {
        delayPromise.clear();
        if (res instanceof Error) {
          // exceptionPromise worked out
          throw Error;
        } else {
          // Normal return
          return res;
        }
      } else {
        throw new Error('Command timeout');
      }
    };
  }

  function setCommandHandler<T extends Types.CommandCode>(commandCode: T): Types.Command<T> {
    return async function (request, timeout: number = DEFAULT_COMMAND_TIMEOUT) {
      logger.debug(`Running command "${commandCode}" with timeout ${timeout} seconds`);
      const delayPromise = delay(timeout * 1000);
      let error: Error | null = null;
      let res: Types.CommandMap[T][1] | Error | void;
      try {
        res = await Promise.race([runCommand(commandCode, request), exceptionPromise, delayPromise]);
      } catch (err) {
        error = err;
      }
      // Cancel the timers
      delayPromise.clear();
      if (error != null) {
        throw error;
      }
      if (res != null) {
        if (res instanceof Error) {
          // exceptionPromise worked out
          throw res;
        } else {
          // Normal return
          return res;
        }
      } else {
        // delayPromise worked out
        throw new Error('Command timeout');
      }
    };
  }

  const events: Types.Events = {
    onChannelStatus: setEventHandler('on_channel_status'),
    onTextMessage: setEventHandler('on_text_message'),
    onStreamStart: setEventHandler('on_stream_start'),
    onStreamStop: setEventHandler('on_stream_stop'),
    onError: setEventHandler('on_error'),
    onAudioData: setEventHandler('on_audio_data'),
  };

  const awaits: Types.Awaits = {
    onChannelStatus: setAwaitHandler('onChannelStatus'),
    onTextMessage: setAwaitHandler('onTextMessage'),
    onStreamStart: setAwaitHandler('onStreamStart'),
    onStreamStop: setAwaitHandler('onStreamStop'),
    onError: setAwaitHandler('onError'),
    onAudioData: setAwaitHandler('onAudioData'),
  };

  const commands: Types.Commands = {
    logon: setCommandHandler('logon'),
    sendTextMessage: setCommandHandler('send_text_message'),
    startStream: setCommandHandler('start_stream'),
    stopStream: setCommandHandler('stop_stream'),
    sendData: setCommandHandler('send_data'),
  };

  try {
    ws = await new Promise<WebSocket>(function (resolve, reject) {
      try {
        logger.debug(`Connecting to: ${address}`);
        const ws = new WebSocket(address, {
          host: 'zello.io',
        });
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

    ws.addEventListener('message', ({ type, data }) => {
      logger.trace('Received message');
      //logger.trace({ type, data }, 'Message details');
      if (ws.readyState === WebSocket.OPEN) {
        if (type === 'message') {
          if (typeof data === 'string') {
            const json = JSON.parse(data);
            if (Api.isCommandResponse(json)) {
              //
              // Command response
              //
              logger.trace(`Message is command response, seq = ${seq}`);
              if (commandPromises.has(json.seq)) {
                const commandPromise = commandPromises.get(json.seq)!;
                logger.trace(`Found original command: ${commandPromise.command}`);
                commandPromises.delete(json.seq);
                commandPromise.promise.resolve(json);
              }
            } else if (Api.isEvent(json)) {
              //
              // Event
              //
              const eventCode = json.command;
              logger.trace(`Message is event: ${eventCode}`);
              const callback = callbacks[eventCode];
              if (callback != null) {
                logger.trace(`Running callback`);
                callback(json as any);
              }
              // Special case for audio stream starts
              if (Api.isEventStreamStart(json)) {
                // TODO: close stream if it's not the stream we requested
                // Check if we have a callback for it
                const callback = callbacks['on_audio_data'];
                if (callback != null) {
                  logger.trace('Found audio stream callback, creating audio stream');
                  // Create audio stream
                  const stream = new Readable({ read: () => {} });
                  expectedAudioStreams.set(json.stream_id, stream);
                  const opusInfo = decodeCodecHeader(json.codec_header);
                  callback({
                    event: json,
                    opusInfo,
                    getStream: initAudioStream(json, opusInfo, stream, logger),
                  });
                }
              } else if (Api.isEventStreamStop(json)) {
                // Stop outgoing stream if any
                if (outgoingDataStream != null) {
                  logger.info('Received on_stream_stop while transmitting data');
                  stopDataStream();
                }
                const callback = callbacks['on_audio_data'];
                if (callback != null) {
                  logger.trace('Found audio stream callback, creating audio stream');
                  if (expectedAudioStreams.has(json.stream_id)) {
                    const stream = expectedAudioStreams.get(json.stream_id)!;
                    expectedAudioStreams.delete(json.stream_id);
                    // Finishing stream
                    stream.push(null);
                  }
                }
              } else if (Api.isEventError(json)) {
                // Special case for errors
                // We should reject all deferred commands
                for (const key of Array.from(commandPromises.keys())) {
                  const commandPromise = commandPromises.get(key)!;
                  logger.trace(`Cancelling command: ${commandPromise.command}`);
                  commandPromises.delete(key);
                  commandPromise.promise.reject(new Error(json.error));
                }
              }
            } else {
              logger.warn(json, 'Unknown message');
            }
          } else if (typeof data === 'object' && Buffer.isBuffer(data)) {
            logger.trace(`Message is data packet of length ${data.length}`);
            //logger.trace(data, 'Data packet');
            const packet = unpackPacket(data);
            if (packet != null) {
              if (Api.isPacketAudio(packet)) {
                logger.trace(`Message is audio packet number: ${packet.packetId}`);
                if (expectedAudioStreams.has(packet.streamId)) {
                  const stream = expectedAudioStreams.get(packet.streamId)!;
                  stream.push(packet.data);
                } else {
                  // Stop outgoing stream if any as we cannot receive a packet of
                  // this type during a transmission.
                  if (outgoingDataStream != null) {
                    logger.debug('Received audio data while transmitting audio');
                    stopDataStream();
                  }
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
        logger.warn('Received message while ws.readyState = ' + webSocketStateNames[ws.readyState]);
      }
    });

    const ctl: Types.Ctl = {
      close: () => {
        logger.debug('Ctl: requested socket close');
        ws.close();
        closeRequested = true;
        // Destroy outgoing stream if any
        if (outgoingDataStream != null) {
          stopDataStream();
        }
        // Close all incoming streams
        for (const key of expectedAudioStreams.keys()) {
          const item = expectedAudioStreams.get(key)!;
          item.destroy();
          expectedAudioStreams.delete(key);
        }
        return closePromise;
      },
      status: () => {
        logger.debug('Ctl: requested status');
        return webSocketStateNames[ws.readyState];
      },
      run: async (script) => {
        logger.debug('Ctl: requested user script execution');
        return await executeScript(script, zello);
      },
    };

    const zelloMacro: Types.ZelloMacro = {
      ctl,
      events,
      commands,
      awaits,
      logger,
      name,
    };

    const zello: Types.Zello = {
      ...zelloMacro,
      macros: getMacros(zelloMacro),
    };

    if (script) {
      await executeScript(script, zello);
    }

    return zello;
  } catch (err) {
    throw new Error(err.message);
  }
}

export default zello;
