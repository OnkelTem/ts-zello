import * as Api from './api';
import { Readable, Writable } from 'stream';
import { ArrayCombine } from './utility-types';
import { Logger, LoggerOptions } from 'pino';
import { WsState } from './ws';
import { getMacros } from './macros';

//
// Events
//

// Add custom events

const customEventCodes = ['on_audio_data', 'on_image_data'] as const;
const customEventNames = ['onAudioData', 'onImageData'] as const;

type StreamGetterOptions = {
  pcm:
    | boolean
    | {
        resample?: boolean | SamplingRate;
        stabilize?: boolean | number;
      };
};

type StreamGetter = (options?: StreamGetterOptions) => Readable;

interface CustomEventAudioData {
  event: Api.EventStreamStart;
  opusInfo: OpusInfo;
  getStream: StreamGetter;
}

interface CustomEventImageData {
  event: Api.EventImage;
}

type CustomEventList = [CustomEventAudioData, CustomEventImageData];

type EventCodes = [...typeof Api.eventCodes, ...typeof customEventCodes];
type EventCode = EventCodes[number];
type EventNames = [...typeof Api.eventNames, ...typeof customEventNames];
type EventName = EventNames[number];
type EventList = [...Api.EventList, ...CustomEventList];

type EventMap = ArrayCombine<EventCodes, EventList>;
type EventNameToCode = ArrayCombine<EventNames, EventCodes>;

type EventCallback<T extends EventCode> = (data: EventMap[T]) => void;
type EventCallbacks = {
  [P in EventCode]?: EventCallback<P>;
};
type Event<T extends EventCode> = (cb: EventCallback<T>) => void;
type Events = {
  [P in EventName]: Event<EventNameToCode[P]>;
};

//
// Commands
//

// Add custom commands

const customCommandCodes = ['send_audio_data', 'send_image_data'] as const;
const customCommandNames = ['sendAudioData', 'sendImageData'] as const;

interface CustomCommandSendAudioDataRequest {
  streamId: number;
  frameSize: number;
}
interface CustomCommandSendAudioDataResponse {
  stream: Writable;
}

interface CustomCommandSendImageDataRequest {
  imageId: number;
  fullSizeData: Buffer;
  thumbnailData: Buffer;
}
interface CustomCommandSendImageDataResponse {
  (): Promise<void>;
}

type CustomCommandList = [
  [CustomCommandSendAudioDataRequest, CustomCommandSendAudioDataResponse],
  [CustomCommandSendImageDataRequest, CustomCommandSendImageDataResponse],
];

type CommandCodes = [...typeof Api.commandCodes, ...typeof customCommandCodes];
type CommandCode = CommandCodes[number];
type CommandNames = [...typeof Api.commandNames, ...typeof customCommandNames];
type CommandName = CommandNames[number];
type CommandList = [...Api.CommandList, ...CustomCommandList];

type CommandMap = ArrayCombine<CommandCodes, CommandList>;
type CommandNameToCode = ArrayCombine<CommandNames, CommandCodes>;

type Command<T extends CommandCode> = (
  request: Omit<CommandMap[T][0], 'command'>,
  timeout?: number,
) => Promise<CommandMap[T][1]>;
type Commands = {
  [P in CommandName]: Command<CommandNameToCode[P]>;
};

function isCommandSendAudioData(arg: any, command: CommandCode): arg is CustomCommandSendAudioDataRequest {
  return command === 'send_audio_data';
}

function isCommandSendImageData(arg: any, command: CommandCode): arg is CustomCommandSendImageDataRequest {
  return command === 'send_image_data';
}

//
// Awaits
//

type AwaitFilterCallback<T extends EventCode> = (data: EventMap[T]) => boolean;
type Await<T extends EventName> = (
  filter: AwaitFilterCallback<EventNameToCode[T]> | boolean,
  timeout: number,
) => Promise<EventMap[EventNameToCode[T]]>;
type Awaits = {
  [P in EventName]: Await<P>;
};

//
// Script
//

type Zello = {
  name: string;
  ctl: Readonly<Ctl>;
  events: Readonly<Events>;
  commands: Readonly<Commands>;
  awaits: Readonly<Awaits>;
  macros: Readonly<ReturnType<typeof getMacros>>;
  logger: Logger;
};

type ZelloMacro = Omit<Zello, 'macros'>;

type Script<TReturn> =
  | ((props: Readonly<Zello>) => Generator<Promise<any>, TReturn, any>)
  | ((props: Readonly<Zello>) => TReturn);

function isScript(arg: any): arg is Script<unknown> {
  return arg != null && typeof arg === 'function';
}

function isScriptGenerator<T, TReturn, TNext>(arg: any): arg is Generator<T, TReturn, TNext> {
  return arg != null && typeof arg === 'object' && typeof arg.next === 'function' && typeof arg.throw === 'function';
}

//
// Macros
//

type Macro<T> = (props: Omit<Zello, 'macros'>) => T;

//
// Options
//

type Options = {
  logger: LoggerOptions | Logger;
  name: string;
};

function isOptions(arg: any): arg is Options {
  return arg != null && typeof arg === 'object' && ((arg as Options).logger != null || (arg as Options).name != null);
}

//
// Ctl
//

interface Ctl {
  close: () => Promise<void>;
  status: () => WsState;
  run: <R extends any = void>(script: Script<R>) => Promise<R>;
}

type ServerAddress = string;

function isServerAddress(arg: any): arg is ServerAddress {
  return arg != null && typeof arg === 'string';
}

function isPromise(arg: any): arg is Promise<any> {
  return !!arg && typeof arg.then === 'function';
}

type OpusInfo = {
  channels: number;
  inputSampleRate: number;
  framesPerPacket: number;
  frameSize: number;
};

const samplingRates = [8000, 12000, 16000, 24000, 48000] as const;
type SamplingRate = typeof samplingRates[number];
const frameSizes = [2.5, 5, 10, 20, 40, 60] as const;
type FrameSize = typeof frameSizes[number];
type Channels = 1 | 2;

type FFmpegArgs = string[];

type DeferredPromise<T> = {
  resolve: (arg: T) => void;
  reject?: any;
};

export {
  Events,
  Commands,
  Awaits,
  CommandCode,
  CommandMap,
  isCommandSendAudioData,
  isCommandSendImageData,
  EventCallbacks,
  EventNameToCode,
  EventName,
  EventCode,
  Event,
  Await,
  EventMap,
  Command,
  Macro,
  Script,
  Options,
  Ctl,
  isServerAddress,
  isScript,
  isScriptGenerator,
  isOptions,
  isPromise,
  Zello,
  ZelloMacro,
  StreamGetter,
  OpusInfo,
  DeferredPromise,
  samplingRates,
  SamplingRate,
  FFmpegArgs,
  frameSizes,
  FrameSize,
  Channels,
  StreamGetterOptions,
};
