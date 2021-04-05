import * as WebSocket from 'ws';

const wsStates = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'] as const;
export type WsState = typeof wsStates[number];

export const webSocketStateNames: { [key: number]: WsState } = {
  [WebSocket.CONNECTING]: 'CONNECTING',
  [WebSocket.OPEN]: 'OPEN',
  [WebSocket.CLOSING]: 'CLOSING',
  [WebSocket.CLOSED]: 'CLOSED',
};
