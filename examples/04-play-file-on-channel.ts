import fs from 'fs';
import pino from 'pino';
import { cred1 } from './utils';
import zello, { DEFAULT_ZELLO_OPTIONS, Zello, getAutoDecodeStream } from '../lib';

const pinoLogger = pino(DEFAULT_ZELLO_OPTIONS.logger);

let z: Zello;

if (process.argv.length < 3) {
  console.error('Missed required parameter: the filename to play');
  process.exit(1);
}
const filename = process.argv[2];

if (!fs.existsSync(filename)) {
  console.error(`File not found: "${filename}"`);
  process.exit(2);
}

const samplingRate = 16000;
const frameSize = 60;
const stream = fs.createReadStream(filename).pipe(
  getAutoDecodeStream(pinoLogger, {
    samplingRate,
    volumeFactor: 0.3,
  }),
);

async function main() {
  z = await zello({ logger: pinoLogger });
  try {
    await z.ctl.run(function* ({ macros }) {
      yield macros.login(cred1);
      yield macros.sendAudio(stream, {
        transcode: { samplingRate, frameSize, bitrateKbps: 32, channels: 1 },
      });
    });
  } catch (err) {
    console.log(err);
  }
  await shutdown();
}

async function shutdown() {
  if (z && z.ctl.status() === 'OPEN') {
    console.warn('Closing...');
    await stream.destroy();
    await z.ctl.close();
  }
}

process.on('SIGINT', async function () {
  console.warn('Received SIGINT: Stopped by user');
  await shutdown();
  process.exit();
});

/**
 * Main function
 */
(async () => {
  await main();
})();
