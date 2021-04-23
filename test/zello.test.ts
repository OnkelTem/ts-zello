import { existsSync, readFileSync, statSync, unlinkSync } from 'fs';
import zello, { CommandLogonRequest, getAutoDecodeStream } from '../lib';
import fs from 'fs';
import prism from 'prism-media';
import pEvent from 'p-event';
import delay from 'delay';
import Speaker from 'speaker';
import tmp from 'tmp';

const ZELLO_SERVER = 'wss://zello.io/ws';
const MP3 = 'test/fixtures/echoed-ding-459.mp3';
const IMAGE = 'test/fixtures/image.jpeg';
const TESTS_DELAY = 5000;

let cred1: CommandLogonRequest;
let cred2: CommandLogonRequest;

beforeAll(() => {
  const raw = readFileSync('test/fixtures/credentials.json', 'utf8');
  const data = JSON.parse(raw);
  cred1 = data[0];
  cred2 = data[1];
});

beforeEach(async () => {
  await delay(TESTS_DELAY);
});

test('should connect to a server and disconnect', async () => {
  const z = await zello(ZELLO_SERVER);
  expect(z.ctl.status()).toBe('OPEN');
  await delay(1000);
  await z.ctl.close();
  expect(z.ctl.status()).toBe('CLOSED');
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

test('should login to a server', async () => {
  const z = await zello(ZELLO_SERVER);
  const res = await z.commands.logon(cred1);
  expect(res).toBeDefined();
  expect(res?.refresh_token).toBeDefined();
  expect(res?.success).toBe(true);
  await delay(2000);
  await z.ctl.close();
});

test('should login to the channel', async () => {
  const z = await zello(ZELLO_SERVER);
  const p = z.macros.login(cred1);
  await expect(p).resolves.toBeTruthy();
  await z.ctl.close();
});

test("shouldn't login to the channel too fast", async () => {
  const z = await zello(ZELLO_SERVER);
  const p = z.macros.login(cred1, 0.05);
  await expect(p).rejects.toThrow(/Command timeout/);
  await z.ctl.close();
});

test("shouldn't login with a wrong password", async () => {
  const z = await zello(ZELLO_SERVER);
  const cred = { ...cred1, password: 'WRONG_PASSWORD' };
  const p = z.macros.login(cred);
  await expect(p).rejects.toThrow(/invalid password/);
  await z.ctl.close();
});

test("shouldn't connect to a wrong channel", async () => {
  const z = await zello(ZELLO_SERVER);
  const cred = { ...cred1, channel: 'UNEXISTING CHANNEL' };
  const p = z.macros.login(cred);
  await expect(p).rejects.toThrow(/channel not available/);
  await z.ctl.close();
});

test("shouldn't connect with a wrong token", async () => {
  const z = await zello(ZELLO_SERVER);
  const cred = { ...cred1, auth_token: 'WRONG_TOKEN' };
  const p = z.macros.login(cred);
  await expect(p).rejects.toThrow(/not authorized/);
  await z.ctl.close();
});

test('should connect two bots to a server', async () => {
  const z1 = await zello(ZELLO_SERVER);
  expect(z1.ctl.status()).toBe('OPEN');
  const z2 = await zello(ZELLO_SERVER);
  expect(z2.ctl.status()).toBe('OPEN');
  await z1.ctl.close();
  await z2.ctl.close();
});

test('should connect two bots to the same channel', async () => {
  const z1 = await zello(ZELLO_SERVER);
  const z2 = await zello(ZELLO_SERVER);
  await z1.macros.login(cred1);
  await z2.macros.login({ ...cred2, channel: cred1.channel });
  await z1.ctl.close();
  await z2.ctl.close();
});

test('should disconnect a bot if its copy is connecting', async () => {
  const z1 = await zello(ZELLO_SERVER);
  const z2 = await zello(ZELLO_SERVER);
  const p = z1.ctl.run(function* ({ macros }) {
    yield macros.login(cred1);
    yield delay(2000);
    // This will fail the whole script, and this
    // would never happen w/o generators.
    yield z2.macros.login(cred1);
    yield delay(3000);
  });
  await expect(p).rejects.toThrow(/Unexpected close/);
  await z1.ctl.close();
  await z2.ctl.close();
});

test('should send a text message to the channel', async () => {
  const z = await zello(ZELLO_SERVER);
  await z.macros.login(cred1);
  await z.commands.sendTextMessage({ text: 'hello' });
  await z.ctl.close();
});

test('should send a text message to the channel and get it with another bot', async () => {
  const text = 'test message ' + new Date().toTimeString();
  const z1 = await zello(ZELLO_SERVER);
  const z2 = await zello(ZELLO_SERVER);
  await z1.macros.login(cred1);
  await z2.macros.login(cred2);
  const [res] = await Promise.all([
    z2.awaits.onTextMessage((event) => event.text === text, 5000),
    z1.commands.sendTextMessage({ text }),
  ]);
  expect(!!res).toBe(true);
  await z1.ctl.close();
  await z2.ctl.close();
});

test('should send mp3 file to the channel and get "on_start_stream" event with another bot', async () => {
  const path = MP3;
  const z1 = await zello(ZELLO_SERVER, { name: 'sender' });
  const z2 = await zello(ZELLO_SERVER, { name: 'receiver' });
  await z1.macros.login(cred1);
  await z2.macros.login(cred2);
  await delay(2000);
  const stream = fs.createReadStream(path).pipe(getAutoDecodeStream(z1.logger));
  const [res] = await Promise.all([
    z2.awaits.onStreamStart((event) => event.from === cred1.username, 5000),
    z1.macros.sendAudio(stream),
  ]);
  await delay(2000);
  expect(!!res).toBe(true);
  await z1.ctl.close();
  await z2.ctl.close();
}, 20000);

test('should send mp3 file to the channel and receive it with another bot', async () => {
  const path = MP3;
  const z1 = await zello(ZELLO_SERVER, { name: 'sender' });
  const z2 = await zello(ZELLO_SERVER, { name: 'receiver' });
  await z1.macros.login(cred1);
  await z2.macros.login(cred2);
  const stream = fs.createReadStream(path).pipe(getAutoDecodeStream(z1.logger));
  const [res] = await Promise.all([
    z2.awaits
      .onAudioData(({ event }) => event.from === cred1.username, 5)
      .then(async ({ opusInfo, getStream }) => {
        const stream = getStream();
        const speaker = new Speaker({
          bitDepth: 16,
          channels: opusInfo.channels,
          sampleRate: opusInfo.inputSampleRate,
        });
        stream.pipe(speaker);
        await pEvent(stream, 'finish');
        return 1;
      }),
    z1.macros.sendAudio(stream, { transcode: { bitrateKbps: 32 } }),
  ]);
  expect(!!res).toBe(true);
  await z1.ctl.close();
  await z2.ctl.close();
});

test('should send mp3 file to the channel save it with another bot', async () => {
  const path = MP3;
  const z1 = await zello(ZELLO_SERVER, { name: 'sender' });
  const z2 = await zello(ZELLO_SERVER, { name: 'receiver' });
  await z1.macros.login(cred1);
  await z2.macros.login(cred2);
  let size: number = 0;
  let outFileName: string | null = null;
  const stream = fs.createReadStream(path).pipe(getAutoDecodeStream(z1.logger));
  const [res] = await Promise.all([
    z2.awaits
      .onAudioData(({ event }) => event.from === cred1.username, 5)
      .then(async ({ getStream }) => {
        const stream = getStream({ pcm: { resample: 24000, stabilize: false } });
        const transcoderStream = new prism.FFmpeg({
          args: ['-ar', '24000', '-channel_layout', 'mono', '-f', 's16le', '-i', '-', '-f', 'mp3'],
        });
        outFileName = tmp.tmpNameSync({ postfix: '.mp3' });
        const ws = fs.createWriteStream(outFileName);
        z2.logger.info(`Writing stream to file: ${outFileName}`);
        stream.pipe(transcoderStream).pipe(ws);
        await pEvent(transcoderStream, 'finish');
        if (existsSync(outFileName)) {
          const stats = statSync(outFileName);
          size = stats.size;
        }
        return 1;
      }),
    z1.macros.sendAudio(stream, {}),
  ]);
  expect(!!res).toBe(true);
  expect(size).toBeGreaterThan(0);
  if (outFileName != null) {
    unlinkSync(outFileName);
  }
  await z1.ctl.close();
  await z2.ctl.close();
});

test('should send an image to the channel', async () => {
  const z = await zello(ZELLO_SERVER);
  await z.macros.login(cred1);
  await z.commands.sendTextMessage({ text: 'Sending image' });
  await z.macros.sendImage(fs.readFileSync(IMAGE));
  await z.ctl.close();
});
