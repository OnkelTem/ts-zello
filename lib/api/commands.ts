//
// Zello API Commands
//

import { Codecs, StreamTypes } from './common';

const commandNames = ['logon', 'sendTextMessage', 'startStream', 'stopStream'] as const;
const commandCodes = ['logon', 'send_text_message', 'start_stream', 'stop_stream'] as const;

type CommandCode = typeof commandCodes[number];

interface CommandRequestBase {
  command: CommandCode;
}

interface CommandLogonRequest extends CommandRequestBase {
  command: 'logon';
  username: string;
  password: string;
  channel: string;
  auth_token: string;
}

interface CommandSendTextMessageRequest extends CommandRequestBase {
  command: 'send_text_message';
  text: string;
  for?: string;
}

interface CommandStartStreamRequest extends CommandRequestBase {
  command: 'start_stream';
  type: StreamTypes;
  codec: Codecs;
  codec_header: string;
  packet_duration: number;
  for?: string;
}

interface CommandStopStreamRequest extends CommandRequestBase {
  command: 'stop_stream';
  streamId: number;
}

interface CommandResponse {
  seq: number;
  success?: boolean;
  error?: string;
}

interface CommandLogonResponse extends CommandResponse {
  refresh_token: string;
}

interface CommandSendTextMessageResponse extends CommandResponse {}

interface CommandStartStreamResponse extends CommandResponse {
  stream_id: number;
}

interface CommandStopStreamResponse extends CommandResponse {}

type CommandList = [
  [CommandLogonRequest, CommandLogonResponse],
  [CommandSendTextMessageRequest, CommandSendTextMessageResponse],
  [CommandStartStreamRequest, CommandStartStreamResponse],
  [CommandStopStreamRequest, CommandStopStreamResponse],
];

function isCommandResponse(arg: unknown): arg is CommandResponse {
  return typeof (arg as CommandResponse).seq !== 'undefined';
}

export {
  commandNames,
  commandCodes,
  CommandRequestBase,
  CommandLogonRequest,
  CommandLogonResponse,
  CommandSendTextMessageRequest,
  CommandSendTextMessageResponse,
  CommandStartStreamRequest,
  CommandStartStreamResponse,
  CommandStopStreamRequest,
  CommandStopStreamResponse,
  CommandList,
  isCommandResponse,
};
