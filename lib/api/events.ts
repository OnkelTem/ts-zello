//
// API Events
//

import { Codecs, ImageSource, ImageType, StreamTypes } from './common';

const eventNames = ['onChannelStatus', 'onTextMessage', 'onStreamStart', 'onStreamStop', 'onImage', 'onError'] as const;
const eventCodes = [
  'on_channel_status',
  'on_text_message',
  'on_stream_start',
  'on_stream_stop',
  'on_image',
  'on_error',
] as const;

type EventList = [EventChannelStatus, EventTextMessage, EventStreamStart, EventStreamStop, EventImage, EventError];

type EventCode = typeof eventCodes[number];

interface EventBase {
  command: EventCode;
}

interface EventChannelStatus extends EventBase {
  command: 'on_channel_status';
  channel: string;
  status: 'online' | 'offline';
  users_online: number;
  images_supported: boolean;
  texting_supported: boolean;
  locations_supported: boolean;
  error: string;
  error_type: string;
}

interface EventTextMessage extends EventBase {
  command: 'on_text_message';
  channel: string;
  from: string;
  for: boolean | string;
  message_id: number;
  text: string;
}

interface EventStreamStart extends EventBase {
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

interface EventStreamStop extends EventBase {
  command: 'on_stream_stop';
  stream_id: number;
}

interface EventImage extends EventBase {
  command: 'on_image';
  channel: string;
  from: string;
  for: boolean | string;
  message_id: number;
  type: ImageType;
  source: ImageSource;
  width: number;
  height: number;
}

interface EventError extends EventBase {
  error: string;
}

function isEvent(arg: unknown): arg is EventBase {
  return typeof (arg as EventBase).command !== 'undefined';
}

// function isEventChannelStatus(arg: EventBase): arg is EventChannelStatus {
//   return arg.command === 'on_channel_status';
// }

function isEventError(arg: EventBase): arg is EventError {
  return arg.command === 'on_error';
}

function isEventStreamStart(arg: EventBase): arg is EventStreamStart {
  return arg.command === 'on_stream_start';
}

function isEventStreamStop(arg: EventBase): arg is EventStreamStop {
  return arg.command === 'on_stream_stop';
}

export {
  eventCodes,
  eventNames,
  EventChannelStatus,
  EventStreamStart,
  EventTextMessage,
  EventImage,
  EventError,
  EventList,
  isEvent,
  isEventStreamStart,
  isEventStreamStop,
  isEventError,
};
