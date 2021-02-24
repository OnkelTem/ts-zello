import WebSocket from 'ws';

/* Commands */

export enum CommandNames {
  LOGON = 'logon',
  SEND_TEXT_MESSAGE = 'send_text_message',
}

export interface CommandLogonRequest {
  username: string;
  password: string;
  channel: string;
  auth_token: string;
}

export interface CommandSendTextMessageRequest {
  text: string;
  for?: string;
}

export interface CommandResponse {
  seq: number;
  success?: boolean;
  error?: string;
}

export function isCommandResponse(arg: any): arg is CommandResponse {
  return typeof (arg as CommandResponse).seq !== 'undefined';
}

export interface CommandLogonResponse extends CommandResponse {
  refresh_token: string;
}

export interface CommandSendTextMessageResponse extends CommandResponse {}

export interface CommandMap {
  [CommandNames.LOGON]: [CommandLogonRequest, CommandLogonResponse];
  [CommandNames.SEND_TEXT_MESSAGE]: [CommandSendTextMessageRequest, CommandSendTextMessageResponse];
}

/* Events */

export enum EventNames {
  CHANNEL_STATUS = 'on_channel_status',
  TEXT_MESSAGE = 'on_text_message',
  STREAM_START = 'on_stream_start',
  ERROR = 'on_error',
}

export const eventNames = [
  EventNames.CHANNEL_STATUS,
  EventNames.STREAM_START,
  EventNames.TEXT_MESSAGE,
  EventNames.ERROR,
] as const;

export interface EventBase {
  command: EventNames;
}

export interface EventChannelStatus extends EventBase {
  command: EventNames.CHANNEL_STATUS;
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
  command: EventNames.TEXT_MESSAGE;
  channel: string;
  from: string;
  for: boolean | string;
  message_id: number;
  text: string;
}

export interface EventError extends EventBase {
  error: string;
}

export enum StreamTypes {
  AUDIO = 'audio',
}
export enum Codecs {
  OPUS = 'opus',
}

export interface EventStreamStart extends EventBase {
  command: EventNames.STREAM_START;
  type: StreamTypes;
  codec: Codecs;
  codec_header: string;
  packet_duration: number;
  stream_id: number;
  channel: string;
  from: string;
  for: string;
}

export function isEvent(arg: any): arg is EventBase {
  return typeof (arg as EventBase).command !== 'undefined';
}

export interface EventMap {
  [EventNames.CHANNEL_STATUS]: EventChannelStatus;
  [EventNames.STREAM_START]: EventStreamStart;
  [EventNames.TEXT_MESSAGE]: EventTextMessage;
  [EventNames.ERROR]: EventError;
}
// type Events = EventMap[keyof EventMap];

const wsStates = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'] as const;
export type WsState = typeof wsStates[number];

export const webSocketStateNames: { [key: number]: WsState } = {
  [WebSocket.CONNECTING]: 'CONNECTING',
  [WebSocket.OPEN]: 'OPEN',
  [WebSocket.CLOSING]: 'CLOSING',
  [WebSocket.CLOSED]: 'CLOSED',
};
