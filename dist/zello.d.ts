import { CommandLogonRequest, CommandSendTextMessageRequest, EventMap, EventNames, WsState } from './types';
declare type EventCallback<T extends EventNames> = (data: EventMap[T]) => void;
export declare type ScriptGenerator = Generator<Promise<any>, void, any>;
export declare type Script = (props: ScriptProps) => ScriptGenerator;
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
export declare function zello(address: string, script?: Script, name?: string): Promise<Ctl>;
export {};
