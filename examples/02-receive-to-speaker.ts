import pino from 'pino';
import Speaker from 'speaker';

import zello, { DEFAULT_ZELLO_OPTIONS, Zello } from '../src';
import { cred1 } from './utils';

const pinoLogger = pino(DEFAULT_ZELLO_OPTIONS.logger);

let z: Zello;

async function main() {
  z = await zello({ logger: pinoLogger });
  try {
    await z.ctl.run(function* ({ macros, events }) {
      events.onAudioData(({ event, opusInfo, getStream }) => {
        pinoLogger.info(`Receiving audio from ${event.from}`);
        pinoLogger.debug(event, 'event');
        const stream = getStream();
        const speaker = new Speaker({
          sampleRate: opusInfo.inputSampleRate,
          channels: opusInfo.channels,
          bitDepth: 16,
        });
        stream.pipe(speaker);
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
