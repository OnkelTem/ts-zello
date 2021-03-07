import { readFileSync, createReadStream } from 'fs';
import { zello, CommandLogonRequest, StreamTypes, Codecs } from '../lib';
import * as fs from 'fs';
import prism from 'prism-media';
import Speaker from 'speaker';
import { decodeCodecHeader, encodeCodecHeader } from '../lib/utils';
import { getOpusReader, OpusInfo, OpusReader } from '../lib/opus-stream';
import pEvent from 'p-event';

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
  //await delay(TESTS_DELAY);
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

test.only('should send mp3 file to a channel and get "on_start_stream" event with another bot', async () => {
  const sender = await zello(ZELLO_SERVER, function* ({ commands, macros, awaits }) {
    yield commands.logon(cred1);
  });
  const receiver = await zello(ZELLO_SERVER, function* ({ commands }) {
    yield commands.logon(cred2);
  });
  await delay(3000);
  const [, res] = await Promise.all([
    sender.run(function* ({ macros }) {
      const rs = fs.createReadStream('test/fixtures/echoed-ding-459.mp3');
      yield macros.sendAudio(rs);
    }),
    receiver.run(function* ({ awaits }) {
      const ev = yield awaits.onStreamStart((event) => {
        return event.from === cred1.username;
      }, 2000);
      return ev !== undefined;
    }),
  ]);
  await sender.close();
  await receiver.close();
  expect(res).toBe(true);
}, 20000);

test.only('should send mp3 file to a channel and download it with another bot', async () => {
  const sender = await zello(ZELLO_SERVER, function* ({ commands, macros, awaits }) {
    yield commands.logon(cred1);
  });
  const receiver = await zello(ZELLO_SERVER, function* ({ commands }) {
    yield commands.logon(cred2);
  });
  await delay(3000);
  const [, res] = await Promise.all([
    sender.run(function* ({ macros }) {
      const rs = fs.createReadStream('test/fixtures/echoed-ding-459.mp3');
      yield macros.sendAudio(rs);
    }),
    receiver.run(function* ({ awaits }) {
      const ev = yield awaits.onStreamStart((event) => {
        return event.from === cred1.username;
      }, 2000);
      return ev !== undefined;
    }),
  ]);
  await sender.close();
  await receiver.close();
  expect(res).toBe(true);
}, 20000);

test('receive audio from a channel', async () => {
  const z = await zello(ZELLO_SERVER, function* ({ commands, events }) {
    yield commands.logon(cred1);
    events.onStreamStartAudio(({ event, stream }) => {
      const opusInfo = decodeCodecHeader(event.codec_header);
      const opusOpt = {
        rate: opusInfo.inputSampleRate,
        channels: opusInfo.channels,
        frameSize: opusInfo.frameSize,
      };
      const opusD = new prism.opus.Decoder(opusOpt);
      // Create the Speaker instance
      const speaker = new Speaker({
        channels: opusInfo.channels,
        //bitDepth: 16,
        sampleRate: opusInfo.inputSampleRate,
      });
      stream.pipe(opusD).pipe(speaker);
    });
    // const rs = fs.createReadStream('test/fixtures/01.mp3');
    // yield commands.sendAudio(rs, { bitrateKbps: 8 });
  });
  await delay(30000);
  await z.close();
}, 40000);
