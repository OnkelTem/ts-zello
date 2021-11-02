import pino from 'pino';
import prism from 'prism-media';
import Speaker from 'speaker';

import { cred1 } from './utils';
import zello, { DEFAULT_ZELLO_OPTIONS, Zello, StabilizeStream, StabilizeStreamOptions } from '../src';
import { getBitrateStatsStream } from './utils';

const pinoLogger = pino(DEFAULT_ZELLO_OPTIONS.logger);

let z: Zello;

async function main() {
  z = await zello(
    function* ({ commands, events }) {
      events.onAudioData(({ event, opusInfo, getStream }) => {
        pinoLogger.info(`Receiving audio from ${event.from}`);
        pinoLogger.debug(event, 'event');

        const opusStream = getStream({ pcm: false });

        const frameSize = (opusInfo.inputSampleRate * opusInfo.frameSize) / 1000;
        const opusOpt = {
          rate: opusInfo.inputSampleRate,
          channels: opusInfo.channels,
          frameSize,
        };
        pinoLogger.info(opusOpt, 'opusOpt');
        const opusDecoder = new prism.opus.Decoder(opusOpt);

        const bufferDurationInPackets = Math.round(1000 / event.packet_duration);
        const bufferSize = bufferDurationInPackets * frameSize * opusInfo.framesPerPacket;
        const stabilizeOpts: StabilizeStreamOptions = {
          bufferSize,
          readableHighWaterMark: bufferSize,
          logger: pinoLogger,
        };
        pinoLogger.info(stabilizeOpts);
        const stabilize = new StabilizeStream(stabilizeOpts);

        const speaker = new Speaker({
          channels: opusInfo.channels,
          bitDepth: 16,
          sampleRate: opusInfo.inputSampleRate,
        });

        opusStream.pipe(getBitrateStatsStream(3, pinoLogger)).pipe(opusDecoder).pipe(stabilize).pipe(speaker);
      });
      yield commands.logon(cred1);
    },
    { logger: pinoLogger },
  );
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
