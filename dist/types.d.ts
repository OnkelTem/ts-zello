export declare enum CommandNames {
    LOGON = "logon",
    SEND_TEXT_MESSAGE = "send_text_message"
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
export declare function isCommandResponse(arg: any): arg is CommandResponse;
export interface CommandLogonResponse extends CommandResponse {
    refresh_token: string;
}
export interface CommandSendTextMessageResponse extends CommandResponse {
}
export interface CommandMap {
    [CommandNames.LOGON]: [CommandLogonRequest, CommandLogonResponse];
    [CommandNames.SEND_TEXT_MESSAGE]: [CommandSendTextMessageRequest, CommandSendTextMessageResponse];
}
export declare enum EventNames {
    CHANNEL_STATUS = "on_channel_status",
    TEXT_MESSAGE = "on_text_message",
    STREAM_START = "on_stream_start",
    ERROR = "on_error"
}
export declare const eventNames: readonly [EventNames.CHANNEL_STATUS, EventNames.STREAM_START, EventNames.TEXT_MESSAGE, EventNames.ERROR];
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
export declare enum StreamTypes {
    AUDIO = "audio"
}
export declare enum Codecs {
    OPUS = "opus"
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
export declare function isEvent(arg: any): arg is EventBase;
export interface EventMap {
    [EventNames.CHANNEL_STATUS]: EventChannelStatus;
    [EventNames.STREAM_START]: EventStreamStart;
    [EventNames.TEXT_MESSAGE]: EventTextMessage;
    [EventNames.ERROR]: EventError;
}
declare const wsStates: readonly ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
export declare type WsState = typeof wsStates[number];
export declare const webSocketStateNames: {
    [key: number]: WsState;
};
export {};
