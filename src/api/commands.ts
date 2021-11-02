//
// Zello API Commands
//

import { Codecs, StreamType, ImageType, ImageSource } from './common';

const commandNames = ['logon', 'sendTextMessage', 'startStream', 'stopStream', 'sendImage'] as const;
const commandCodes = ['logon', 'send_text_message', 'start_stream', 'stop_stream', 'send_image'] as const;

type CommandCode = typeof commandCodes[number];

interface CommandRequestBase {
  command: CommandCode;
}

interface CommandResponse {
  seq: number;
  success?: boolean;
  error?: string;
}

// Command: logon

interface CommandLogonRequest extends CommandRequestBase {
  command: 'logon';
  username: string;
  password: string;
  channel: string;
  auth_token: string;
}
interface CommandLogonResponse extends CommandResponse {
  refresh_token: string;
}

// Command: send_text_message

interface CommandSendTextMessageRequest extends CommandRequestBase {
  command: 'send_text_message';
  text: string;
  for?: string;
}
interface CommandSendTextMessageResponse extends CommandResponse {}

// Command: start_stream

interface CommandStartStreamRequest extends CommandRequestBase {
  command: 'start_stream';
  type: StreamType;
  codec: Codecs;
  codec_header: string;
  packet_duration: number;
  for?: string;
}
interface CommandStartStreamResponse extends CommandResponse {
  stream_id: number;
}

// Command: stop_stream

interface CommandStopStreamRequest extends CommandRequestBase {
  command: 'stop_stream';
  streamId: number;
}
interface CommandStopStreamResponse extends CommandResponse {}

// Command: send_image

interface CommandSendImageRequest extends CommandRequestBase {
  command: 'send_image';
  type: ImageType;
  source: ImageSource;
  for?: string;
  width: number;
  height: number;
  thumbnail_content_length: number;
  content_length: number;
}
interface CommandSendImageResponse extends CommandResponse {
  image_id: number;
}

type CommandList = [
  [CommandLogonRequest, CommandLogonResponse],
  [CommandSendTextMessageRequest, CommandSendTextMessageResponse],
  [CommandStartStreamRequest, CommandStartStreamResponse],
  [CommandStopStreamRequest, CommandStopStreamResponse],
  [CommandSendImageRequest, CommandSendImageResponse],
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
  CommandSendImageRequest,
  CommandSendImageResponse,
  CommandList,
  isCommandResponse,
};
