"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.zello = void 0;
const ws_1 = __importDefault(require("ws"));
const types_1 = require("./types");
function isPromise(arg) {
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
function zello(address, script, name) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            let bot = name != null ? name : 'bot' + botCounter++;
            let closeRequested = false;
            let deferredClosePromise = {
                resolve: null,
            };
            const closePromise = new Promise(function (resolve) {
                deferredClosePromise = { resolve };
            });
            let loggedIn = false;
            let deferredLogonPromise = {
                resolve: null,
            };
            const logonPromise = new Promise(function (resolve) {
                deferredLogonPromise = { resolve };
            });
            const ws = yield new Promise(function (resolve, reject) {
                try {
                    let ws = new ws_1.default(address);
                    ws.addEventListener('open', () => {
                        resolve(ws);
                    }, { once: true });
                    ws.addEventListener('error', (err) => {
                        //console.error(`${bot} error`, err);
                        reject(err);
                    }, { once: true });
                }
                catch (err) {
                    reject(err);
                }
            });
            let deferredExceptionPromise = {
                resolve: null,
            };
            const exceptionPromise = new Promise(function (resolve) {
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
            let seq = 0;
            let seqReservedCount = 0;
            const commandPromises = new Map();
            function command(commandName, data) {
                seqReservedCount++;
                const seqCurrent = seq + seqReservedCount;
                const promise = new Promise(function (resolve, reject) {
                    commandPromises.set(seqCurrent, { resolve, reject });
                });
                if (ws.readyState === ws_1.default.OPEN) {
                    ws.send(JSON.stringify(Object.assign(Object.assign({}, data), { command: commandName, seq: seqCurrent })), (err) => {
                        if (err == null) {
                            seq = seqCurrent;
                        }
                        else {
                            if (commandPromises.has(seqCurrent)) {
                                const commandPromise = commandPromises.get(seqCurrent);
                                commandPromises.delete(seqCurrent);
                                commandPromise.reject(err);
                            }
                        }
                    });
                }
                else {
                    // Cannot send command, reject and remove it immediately
                    const commandPromise = commandPromises.get(seqCurrent);
                    commandPromises.delete(seqCurrent);
                    commandPromise.reject(new Error(`Cannot send command: socket state is ${types_1.webSocketStateNames[ws.readyState]}`));
                }
                return promise;
            }
            const callbacks = {};
            ws.addEventListener('message', ({ type, data }) => {
                //console.log(`${bot} onmessage`, type, data);
                if (ws.readyState === ws_1.default.OPEN) {
                    if (type === 'message' && typeof data === 'string') {
                        const json = JSON.parse(data);
                        if (types_1.isCommandResponse(json)) {
                            if (commandPromises.has(json.seq)) {
                                const commandPromise = commandPromises.get(json.seq);
                                commandPromises.delete(json.seq);
                                commandPromise.resolve(json);
                            }
                        }
                        else if (types_1.isEvent(json)) {
                            // Events
                            const eventName = json.command;
                            const callback = callbacks[eventName];
                            if (callback != null) {
                                callback(json);
                            }
                            // Special case for errors
                            if (eventName === types_1.EventNames.ERROR) {
                                // We should reject all deferred commands
                                for (const key of commandPromises.keys()) {
                                    const commandPromise = commandPromises.get(key);
                                    commandPromises.delete(key);
                                    commandPromise.reject(new Error(json.error));
                                }
                            }
                            // Special case for login command
                            if (eventName === types_1.EventNames.CHANNEL_STATUS && !loggedIn) {
                                loggedIn = true;
                                deferredLogonPromise.resolve(json);
                            }
                        }
                    }
                }
                else {
                    //console.warn('Receiving message while ws.readyState = ' + ws.readyState);
                }
            });
            function executeScript(script) {
                return __awaiter(this, void 0, void 0, function* () {
                    const gen = script(scriptProps);
                    let param = undefined;
                    let error = undefined;
                    while (true) {
                        let value;
                        let done;
                        const obj = !error ? gen.next(param) : gen.throw(error);
                        value = obj.value;
                        done = obj.done;
                        if (done) {
                            break;
                        }
                        if (isPromise(value)) {
                            let res;
                            try {
                                res = yield Promise.race([value, exceptionPromise]);
                            }
                            catch (err) {
                                res = err;
                            }
                            // noinspection SuspiciousTypeOfGuard
                            if (res instanceof Error) {
                                error = res;
                            }
                            else {
                                param = res;
                            }
                        }
                    }
                });
            }
            const ctl = {
                close: () => {
                    ws.close();
                    closeRequested = true;
                    return closePromise;
                },
                status: () => {
                    return types_1.webSocketStateNames[ws.readyState];
                },
                run: (script) => __awaiter(this, void 0, void 0, function* () {
                    yield executeScript(script);
                }),
            };
            const events = {
                onChannelStatus: (cb) => {
                    callbacks[types_1.EventNames.CHANNEL_STATUS] = cb;
                },
                onTextMessage: (cb) => {
                    callbacks[types_1.EventNames.TEXT_MESSAGE] = cb;
                },
            };
            const commands = {
                logon: (request) => __awaiter(this, void 0, void 0, function* () {
                    let resp;
                    try {
                        resp = yield command(types_1.CommandNames.LOGON, request);
                    }
                    catch (err) {
                        throw new Error(err);
                    }
                    if (resp.error != null) {
                        throw new Error(resp.error);
                    }
                    const isAuthorized = resp.success != null && resp.success && resp.refresh_token != null;
                    if (!isAuthorized) {
                        throw new Error('authorization failed');
                    }
                    let channelStatus;
                    try {
                        channelStatus = yield logonPromise;
                    }
                    catch (err) {
                        throw new Error(err);
                    }
                    if (channelStatus.status !== 'online') {
                        throw new Error('channel not available');
                    }
                }),
                sendTextMessage: (request) => __awaiter(this, void 0, void 0, function* () {
                    try {
                        yield command(types_1.CommandNames.SEND_TEXT_MESSAGE, request);
                    }
                    catch (err) {
                        throw new Error(err);
                    }
                }),
            };
            const scriptProps = {
                ctl,
                events,
                commands,
            };
            if (script) {
                yield executeScript(script);
            }
            return ctl;
        }
        catch (err) {
            throw new Error(err.message);
        }
    });
}
exports.zello = zello;
//# sourceMappingURL=zello.js.map