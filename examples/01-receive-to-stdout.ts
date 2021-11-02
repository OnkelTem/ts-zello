import pino from 'pino';

import zello, { DEFAULT_ZELLO_OPTIONS, Zello } from '../src';
import { cred1, getPacketsStatsStream } from './utils';

if (process.stdout.isTTY) {
  console.error('This script is going to stream audio data to the stdout.');
  console.error('Please redirect it to a consumer, e.g.:');
  console.error('| aplay -f S16_LE -c 1 -r 48000');
  process.exit(1);
}

const pinoLogger = pino(
  DEFAULT_ZELLO_OPTIONS.logger,
  // Point logger out to stderr to make way for audio stream
  process.stderr,
);

let z: Zello;

async function main() {
  z = await zello({ logger: pinoLogger });
  try {
    await z.ctl.run(function* ({ macros, logger, events }) {
      events.onAudioData(({ event, getStream }) => {
        pinoLogger.info(`Receiving audio from ${event.from}`);
        pinoLogger.debug(event, 'event');
        const stream = getStream({ pcm: { resample: 48000, stabilize: 1 } });
        stream.pipe(getPacketsStatsStream('Decoder output', true, logger)).pipe(process.stdout);
      });
      yield macros.login(cred1);
    });
  } catch (err) {
    pinoLogger.error(err);
  }
}

async function shutdown() {
  if (z && z.ctl.status() === 'OPEN') {
    pinoLogger.warn('Closing');
    await z.ctl.close();
  }
}

process.on('SIGINT', async function () {
  pinoLogger.warn('Received SIGINT: Stopped by user');
  await shutdown();
  process.exit();
});

(async () => {
  await main();
})();
