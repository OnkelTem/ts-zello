"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.webSocketStateNames = exports.isEvent = exports.Codecs = exports.StreamTypes = exports.eventNames = exports.EventNames = exports.isCommandResponse = exports.CommandNames = void 0;
const ws_1 = __importDefault(require("ws"));
/* Commands */
var CommandNames;
(function (CommandNames) {
    CommandNames["LOGON"] = "logon";
    CommandNames["SEND_TEXT_MESSAGE"] = "send_text_message";
})(CommandNames = exports.CommandNames || (exports.CommandNames = {}));
function isCommandResponse(arg) {
    return typeof arg.seq !== 'undefined';
}
exports.isCommandResponse = isCommandResponse;
/* Events */
var EventNames;
(function (EventNames) {
    EventNames["CHANNEL_STATUS"] = "on_channel_status";
    EventNames["TEXT_MESSAGE"] = "on_text_message";
    EventNames["STREAM_START"] = "on_stream_start";
    EventNames["ERROR"] = "on_error";
})(EventNames = exports.EventNames || (exports.EventNames = {}));
exports.eventNames = [
    EventNames.CHANNEL_STATUS,
    EventNames.STREAM_START,
    EventNames.TEXT_MESSAGE,
    EventNames.ERROR,
];
var StreamTypes;
(function (StreamTypes) {
    StreamTypes["AUDIO"] = "audio";
})(StreamTypes = exports.StreamTypes || (exports.StreamTypes = {}));
var Codecs;
(function (Codecs) {
    Codecs["OPUS"] = "opus";
})(Codecs = exports.Codecs || (exports.Codecs = {}));
function isEvent(arg) {
    return typeof arg.command !== 'undefined';
}
exports.isEvent = isEvent;
// type Events = EventMap[keyof EventMap];
const wsStates = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
exports.webSocketStateNames = {
    [ws_1.default.CONNECTING]: 'CONNECTING',
    [ws_1.default.OPEN]: 'OPEN',
    [ws_1.default.CLOSING]: 'CLOSING',
    [ws_1.default.CLOSED]: 'CLOSED',
};
//# sourceMappingURL=types.js.map