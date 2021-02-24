import WebSocket from 'ws';
import {
  CommandLogonRequest,
  CommandLogonResponse,
  CommandMap,
  CommandNames,
  CommandSendTextMessageRequest,
  EventChannelStatus,
  EventError,
  EventMap,
  EventNames,
  isCommandResponse,
  isEvent,
  webSocketStateNames,
  WsState,
} from './types';

type EventCallback<T extends EventNames> = (data: EventMap[T]) => void;

type Callbacks = {
  [P in EventNames]?: EventCallback<P>;
};

type DeferredPromise = {
  resolve: any;
  reject?: any;
};

function isPromise(arg: any): arg is Promise<any> {
  return !!arg && typeof arg.then === 'function';
}

// /**
//  * @see: https://stackoverflow.com/a/41102306/1223483
//  */
// class ZelloError extends Error {
//   constructor(m: string) {
//     super(m);
//     Object.setPrototypeOf(this, ZelloError.prototype);
//   }
// }

let botCounter = 0;

export type ScriptGenerator = Generator<Promise<any>, void, any>;
export type Script = (props: ScriptProps) => ScriptGenerator;

export interface Events {
  readonly onChannelStatus: (cb: EventCallback<EventNames.CHANNEL_STATUS>) => void;
  readonly onTextMessage: (cb: EventCallback<EventNames.TEXT_MESSAGE>) => void;
}

export interface Commands {
  readonly logon: (request: CommandLogonRequest) => Promise<void>;
  readonly sendTextMessage: (request: CommandSendTextMessageRequest) => Promise<void>;
}

export interface Ctl {
  readonly close: () => Promise<void>;
  readonly status: () => WsState;
  readonly run: (script: Script) => Promise<void>;
}

export interface ScriptProps {
  readonly ctl: Ctl;
  readonly events: Events;
  readonly commands: Commands;
}

export async function zello(address: string, script?: Script, name?: string): Promise<Ctl> {
  try {
    let bot = name != null ? name : 'bot' + botCounter++;
    let closeRequested = false;
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
    const logonPromise = new Promise<EventChannelStatus>(function (resolve) {
      deferredLogonPromise = { resolve };
    });

    const ws = await new Promise<WebSocket>(function (resolve, reject) {
      try {
        let ws = new WebSocket(address);
        ws.addEventListener(
          'open',
          () => {
            resolve(ws);
          },
          { once: true },
        );
        ws.addEventListener(
          'error',
          (err) => {
            //console.error(`${bot} error`, err);
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
      //console.warn(`${bot} error`, err);
      const exception = new Error(`Unexpected websocket error: ${err.message}`);
      deferredExceptionPromise.resolve(exception);
    });

    ws.addEventListener('close', (event) => {
      //console.warn(`${bot} onclose`);
      deferredClosePromise.resolve();
      if (!closeRequested) {
        const exception = new Error(`Unexpected close, code: ${event.code}, reason: ${event.reason}`);
        deferredExceptionPromise.resolve(exception);
      }
    });

    let seq: number = 0;
    let seqReservedCount: number = 0;

    const commandPromises = new Map<number, DeferredPromise>();

    function command<T extends CommandNames>(commandName: T, data: CommandMap[T][0]): Promise<CommandMap[T][1]> {
      seqReservedCount++;
      const seqCurrent = seq + seqReservedCount;
      const promise = new Promise<CommandMap[T][1]>(function (resolve, reject) {
        commandPromises.set(seqCurrent, { resolve, reject });
      });
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            ...data,
            command: commandName,
            seq: seqCurrent,
          }),
          (err) => {
            if (err == null) {
              seq = seqCurrent;
            } else {
              if (commandPromises.has(seqCurrent)) {
                const commandPromise = commandPromises.get(seqCurrent)!;
                commandPromises.delete(seqCurrent);
                commandPromise.reject(err);
              }
            }
          },
        );
      } else {
        // Cannot send command, reject and remove it immediately
        const commandPromise = commandPromises.get(seqCurrent)!;
        commandPromises.delete(seqCurrent);
        commandPromise.reject(new Error(`Cannot send command: socket state is ${webSocketStateNames[ws.readyState]}`));
      }
      return promise;
    }

    const callbacks: Callbacks = {};

    ws.addEventListener('message', ({ type, data }) => {
      //console.log(`${bot} onmessage`, type, data);
      if (ws.readyState === WebSocket.OPEN) {
        if (type === 'message' && typeof data === 'string') {
          const json = JSON.parse(data);
          if (isCommandResponse(json)) {
            if (commandPromises.has(json.seq)) {
              const commandPromise = commandPromises.get(json.seq)!;
              commandPromises.delete(json.seq);
              commandPromise.resolve(json);
            }
          } else if (isEvent(json)) {
            // Events
            const eventName = json.command;
            const callback = callbacks[eventName];
            if (callback != null) {
              callback(json as any);
            }
            // Special case for errors
            if (eventName === EventNames.ERROR) {
              // We should reject all deferred commands
              for (const key of commandPromises.keys()) {
                const commandPromise = commandPromises.get(key)!;
                commandPromises.delete(key);
                commandPromise.reject(new Error((json as EventError).error));
              }
            }
            // Special case for login command
            if (eventName === EventNames.CHANNEL_STATUS && !loggedIn) {
              loggedIn = true;
              deferredLogonPromise.resolve(json);
            }
          }
        }
      } else {
        //console.warn('Receiving message while ws.readyState = ' + ws.readyState);
      }
    });

    async function executeScript(script: Script) {
      const gen = script(scriptProps);
      let param: any = undefined;
      let error: Error | undefined = undefined;
      while (true) {
        let value: any;
        let done: boolean | undefined;
        const obj = !error ? gen.next(param) : gen.throw(error);
        value = obj.value;
        done = obj.done;
        if (done) {
          break;
        }
        if (isPromise(value)) {
          let res: any;
          try {
            res = await Promise.race([value, exceptionPromise]);
          } catch (err) {
            res = err;
          }
          // noinspection SuspiciousTypeOfGuard
          if (res instanceof Error) {
            error = res;
          } else {
            param = res;
          }
        }
      }
    }

    const ctl: Ctl = {
      close: () => {
        ws.close();
        closeRequested = true;
        return closePromise;
      },
      status: () => {
        return webSocketStateNames[ws.readyState];
      },
      run: async (script) => {
        await executeScript(script);
      },
    };

    const events: Events = {
      onChannelStatus: (cb: EventCallback<EventNames.CHANNEL_STATUS>) => {
        callbacks[EventNames.CHANNEL_STATUS] = cb;
      },
      onTextMessage: (cb: EventCallback<EventNames.TEXT_MESSAGE>) => {
        callbacks[EventNames.TEXT_MESSAGE] = cb;
      },
    };

    const commands: Commands = {
      logon: async (request: CommandLogonRequest) => {
        let resp: CommandLogonResponse;
        try {
          resp = await command(CommandNames.LOGON, request);
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
        let channelStatus: EventChannelStatus;
        try {
          channelStatus = await logonPromise;
        } catch (err) {
          throw new Error(err);
        }
        if (channelStatus.status !== 'online') {
          throw new Error('channel not available');
        }
      },
      sendTextMessage: async (request: CommandSendTextMessageRequest) => {
        try {
          await command(CommandNames.SEND_TEXT_MESSAGE, request);
        } catch (err) {
          throw new Error(err);
        }
      },
    };

    const scriptProps: ScriptProps = {
      ctl,
      events,
      commands,
    };

    if (script) {
      await executeScript(script);
    }
    return ctl;
  } catch (err) {
    throw new Error(err.message);
  }
}
