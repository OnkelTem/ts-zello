import WebSocket from 'ws';

//
// API Commands
//

export const commandNames = ['logon', 'sendTextMessage', 'startStream', 'stopStream'] as const;
export type CommandName = typeof commandNames[number];
export const commandCodes = ['logon', 'send_text_message', 'start_stream', 'stop_stream'] as const;
export type CommandCode = typeof commandCodes[number];

export interface CommandRequestBase {
  command: CommandCode;
}

export interface CommandLogonRequest extends CommandRequestBase {
  command: 'logon';
  username: string;
  password: string;
  channel: string;
  auth_token: string;
}

export interface CommandSendTextMessageRequest extends CommandRequestBase {
  command: 'send_text_message';
  text: string;
  for?: string;
}

export enum StreamTypes {
  AUDIO = 'audio',
}
export enum Codecs {
  OPUS = 'opus',
}

export interface CommandStartStreamRequest extends CommandRequestBase {
  command: 'start_stream';
  type: StreamTypes;
  codec: Codecs;
  codec_header: string;
  packet_duration: number;
  for?: string;
}

export interface CommandStopStreamRequest extends CommandRequestBase {
  command: 'stop_stream';
  streamId: number;
}

export interface CommandResponse {
  seq: number;
  success?: boolean;
  error?: string;
}

export interface CommandLogonResponse extends CommandResponse {
  refresh_token: string;
}

export interface CommandSendTextMessageResponse extends CommandResponse {}

export interface CommandStartStreamResponse extends CommandResponse {
  stream_id: number;
}

export interface CommandStopStreamResponse extends CommandResponse {}

export interface CommandMap {
  logon: [CommandLogonRequest, CommandLogonResponse];
  sendTextMessage: [CommandSendTextMessageRequest, CommandSendTextMessageResponse];
  startStream: [CommandStartStreamRequest, CommandStartStreamResponse];
  stopStream: [CommandStopStreamRequest, CommandStopStreamResponse];
}

//
// API Events
//

export const eventNames = ['onChannelStatus', 'onTextMessage', 'onStreamStart', 'onError'] as const;
export type EventName = typeof eventNames[number];
export const eventCodes = ['on_channel_status', 'on_text_message', 'on_stream_start', 'on_error'] as const;
export type EventCode = typeof eventCodes[number];

export interface EventBase {
  command: EventCode;
}

export interface EventChannelStatus extends EventBase {
  command: 'on_channel_status';
  channel: string;
  status: string;
  users_online: number;
  images_supported: boolean;
  texting_supported: boolean;
  locations_supported: boolean;
  error: string;
  error_type: string;
}

export interface EventTextMessage extends EventBase {
  command: 'on_text_message';
  channel: string;
  from: string;
  for: boolean | string;
  message_id: number;
  text: string;
}

export interface EventError extends EventBase {
  error: string;
}

export interface EventStreamStart extends EventBase {
  command: 'on_stream_start';
  type: StreamTypes;
  codec: Codecs;
  codec_header: string;
  packet_duration: number;
  stream_id: number;
  channel: string;
  from: string;
  for: string;
}

export interface EventMap {
  onChannelStatus: EventChannelStatus;
  onStreamStart: EventStreamStart;
  onTextMessage: EventTextMessage;
  onError: EventError;
}

const wsStates = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'] as const;
export type WsState = typeof wsStates[number];

export const webSocketStateNames: { [key: number]: WsState } = {
  [WebSocket.CONNECTING]: 'CONNECTING',
  [WebSocket.OPEN]: 'OPEN',
  [WebSocket.CLOSING]: 'CLOSING',
  [WebSocket.CLOSED]: 'CLOSED',
};

export enum PacketTypes {
  UNKNOWN = 0,
  AUDIO = 1,
  IMAGE = 2,
}

export interface PacketBase {
  type: PacketTypes;
  data: Buffer;
}

export interface PacketAudio extends PacketBase {
  type: PacketTypes.AUDIO;
  streamId: number;
  packetId: number;
}

export interface PacketImage extends PacketBase {
  type: PacketTypes.IMAGE;
  messageId: number;
}

export interface PacketUnknown extends PacketBase {
  type: PacketTypes.UNKNOWN;
}

export type Packet = PacketAudio | PacketImage | PacketUnknown;

//     arg.data.length > 0 &&
//     arg.data[0] === BinaryTypes.AUDIO &&

// Current limitation of Zello
export const AUDIO_MAX_CHANNELS = 1;

export enum ErrorMessages {
  CHANNEL_BUSY = 'channel busy',
}

//
// Type Guards
//

export function isCommandResponse(arg: any): arg is CommandResponse {
  return typeof (arg as CommandResponse).seq !== 'undefined';
}

export function isEventChannelStatus(arg: EventBase): arg is EventChannelStatus {
  return arg.command === 'on_channel_status';
}

export function isEventError(arg: EventBase): arg is EventError {
  return arg.command === 'on_error';
}

export function isEventStreamStart(arg: EventBase): arg is EventStreamStart {
  return arg.command === 'on_stream_start';
}

export function isEvent(arg: any): arg is EventBase {
  return typeof (arg as EventBase).command !== 'undefined';
}

export function isPacketAudio(arg: Packet): arg is PacketAudio {
  return arg.type === PacketTypes.AUDIO;
}

export function isPacketImage(arg: Packet): arg is PacketImage {
  return arg.type === PacketTypes.IMAGE;
}
