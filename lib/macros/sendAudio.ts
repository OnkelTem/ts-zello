// Global
import pEvent from 'p-event';
import { Readable } from 'stream';
import delay from 'delay';

// Project
import { getOpusReader, OpusReader, OpusOptions } from '../audio';
import * as Api from '../api';
import { DataWaitPassThroughStream, encodeCodecHeader } from '../utils';
import { Macro } from '../types';

type RetryStrategy = {
  during: number;
  retries: number;
  delay: number;
};

type Options = {
  retry?: Partial<RetryStrategy>;
  transcode?: OpusOptions;
};

const DEFAULT_RETRY_STRATEGY: RetryStrategy = {
  during: 0,
  retries: 0,
  delay: 3,
};

type SendAudio = (inputStream: Readable, options?: Options) => Promise<any>;

const sendAudio: Macro<SendAudio> = function ({ commands, logger }) {
  return async function (inputStream, options) {
    const retry: RetryStrategy = {
      ...DEFAULT_RETRY_STRATEGY,
      ...(options != null && options.retry),
    };
    const transcode = options != null ? options.transcode : null;
    let opusReader: OpusReader;
    try {
      opusReader = await getOpusReader(logger, transcode);
    } catch (err) {
      // Couldn't create OpusReader
      logger.error(err, 'Error creating OPUS reader');
      throw new Error(err);
    }
    const { opusInfo, opusStream } = opusReader;
    const retryCounters = {
      attempt: 1,
      startAtMs: new Date().getTime(),
    };

    // Ensure we have our data ready for streaming
    logger.debug('Making sure the data is ready...');
    const readyInputStream = inputStream.pipe(new DataWaitPassThroughStream());
    await pEvent(readyInputStream, 'dataIsReady');
    logger.debug('Data is ready.');

    // Getting the button
    let resp: Api.CommandStartStreamResponse;
    while (true) {
      logger.info('Requesting the button');
      try {
        resp = await commands.startStream({
          type: Api.StreamTypes.AUDIO,
          codec: Api.Codecs.OPUS,
          codec_header: encodeCodecHeader(opusInfo),
          packet_duration: opusInfo.frameSize,
        });
      } catch (err) {
        throw new Error(err);
      }
      if (resp.error != null) {
        if (resp.error === Api.ErrorMessages.CHANNEL_BUSY) {
          logger.info('Channel busy');
          // Check retry conditions
          if (
            // Reached the number of attempts
            retryCounters.attempt >= retry.retries + 1 &&
            // Reached time limit
            new Date().getTime() - retryCounters.startAtMs >= retry.during * 1000
          ) {
            // Giving up
            throw new Error(resp.error);
          } else {
            // Retrying
            logger.info(`Idling for ${retry.delay} second(s)...`);
            await delay(retry.delay * 1000);
            retryCounters.attempt++;
            logger.debug(`Retrying, attempt: ${retryCounters.attempt}`);
            continue;
          }
        } else {
          logger.debug(`Start stream error: ${resp.error}`);
          // Unknown thing, maybe banned
          throw new Error(resp.error);
        }
      }
      // Successfully got the button
      break;
    }
    logger.info('Got the button!');
    logger.debug(`stream_id: ${resp.stream_id}`);
    const { stream: outStream } = await commands.sendAudioData({
      streamId: resp.stream_id,
      frameSize: opusInfo.frameSize,
    });
    // TODO: Fix the problem with rising exception when stream gets destroyed
    //       https://dev.to/morz/pipeline-api-the-best-way-to-handle-stream-errors-that-nobody-tells-you-about-122o
    logger.info('Start streaming...');
    try {
      readyInputStream.pipe(opusStream).pipe(outStream);
      await pEvent(outStream, ['close', 'finish']);
    } catch (err) {
      logger.error(err, 'ERROR');
    }
    // TODO: Don't send stop stream if we were interrupted
    await commands.stopStream({
      streamId: resp.stream_id,
    });
    logger.info('Stopped streaming!');
  };
};

export default sendAudio;
