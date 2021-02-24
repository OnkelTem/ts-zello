import { readFileSync } from 'fs';
import { zello, CommandLogonRequest } from '../lib';

const ZELLO_SERVER = 'wss://zello.io/ws';
const WRONG_TOKEN = 'UNEXISTING TOKEN';
const TESTS_DELAY = 5000;

let cred1: CommandLogonRequest;
let cred2: CommandLogonRequest;

beforeAll(() => {
  let raw = readFileSync('test/fixtures/credentials.json', 'utf8');
  const data = JSON.parse(raw);
  cred1 = data['primary'];
  cred2 = data['secondary'];
});

beforeEach(async () => {
  await delay(TESTS_DELAY);
});

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('should connect to a server and disconnect', async () => {
  const z = await zello(ZELLO_SERVER);
  expect(z.status()).toBe('OPEN');
  await delay(1000);
  await z.close();
  expect(z.status()).toBe('CLOSED');
});

test("shouldn't connect to a wrong server", async () => {
  await expect(async () => {
    await zello('UNEXISTING URL');
  }).rejects.toThrow(/Invalid URL/);
  await expect(async () => {
    await zello('http://localhost:63792');
  }).rejects.toThrow(/ECONNREFUSED/);
  await expect(async () => {
    await zello('http://google.com');
  }).rejects.toThrow(/Unexpected server response/);
});

test('should connect to a channel', async () => {
  const z = await zello(ZELLO_SERVER, function* ({ commands }) {
    yield commands.logon(cred1);
  });
  await z.close();
});

test("shouldn't connect to a wrong channel", async () => {
  const z = await zello(ZELLO_SERVER);
  await expect(async () => {
    await z.run(function* ({ commands }) {
      yield commands.logon({ ...cred1, channel: 'UNEXISTING CHANNEL' });
    });
  }).rejects.toThrow('channel not available');
  await z.close();
});

test("shouldn't connect with a wrong token", async () => {
  const z = await zello(ZELLO_SERVER);
  await expect(async () => {
    await z.run(function* ({ commands }) {
      yield commands.logon({ ...cred1, auth_token: WRONG_TOKEN });
    });
  }).rejects.toThrow('not authorized');
  await z.close();
});

test('should connect two bots to a server', async () => {
  const z1 = await zello(ZELLO_SERVER);
  expect(z1.status()).toBe('OPEN');
  const z2 = await zello(ZELLO_SERVER);
  expect(z2.status()).toBe('OPEN');
  await z1.close();
  await z2.close();
});

test('should connect two bots to the same channel', async () => {
  const z1 = await zello(ZELLO_SERVER);
  const z2 = await zello(ZELLO_SERVER);
  await z1.run(function* ({ commands }) {
    yield commands.logon(cred1);
    yield delay(2000);
    yield z2.run(function* ({ commands }) {
      yield commands.logon({ ...cred2, channel: cred1.channel });
    });
    yield delay(2000);
  });
  await z1.close();
  await z2.close();
});

test('should disconnect a bot if its copy is connecting', async () => {
  const z1 = await zello(ZELLO_SERVER);
  const z2 = await zello(ZELLO_SERVER);
  await expect(async () => {
    await z1.run(function* ({ commands }) {
      yield commands.logon(cred1);
      yield delay(2000);
      yield z2.run(function* ({ commands }) {
        yield commands.logon(cred1);
      });
      yield delay(3000);
    });
  }).rejects.toThrow(/Unexpected close/);
  await z1.close();
  await z2.close();
});

test('should send a text message to a channel', async () => {
  const z = await zello(ZELLO_SERVER, function* ({ commands }) {
    yield commands.logon(cred1);
    yield commands.sendTextMessage({ text: 'hello' });
  });
  await z.close();
});

test('should send a text message to a channel and get it with another bot', async () => {
  const z1 = await zello(ZELLO_SERVER);
  const z2 = await zello(ZELLO_SERVER);
  const MSG_TEXT = 'test message ' + new Date().toTimeString();
  let res: any;
  await z1.run(function* ({ commands, events }) {
    yield commands.logon(cred1);
    [res] = yield Promise.all([
      Promise.race([
        new Promise((resolve) => {
          events.onTextMessage((data) => {
            if (data.text === MSG_TEXT) {
              resolve(true);
            }
          });
        }),
        delay(3000),
      ]),
      z2.run(function* ({ commands }) {
        yield commands.logon({ ...cred2, channel: cred1.channel });
        yield commands.sendTextMessage({ text: MSG_TEXT });
      }),
    ]);
  });
  expect(!!res).toBe(true);
  await z1.close();
  await z2.close();
});
