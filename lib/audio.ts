import prism from 'prism-media';
import pEvent from 'p-event';
import { Duplex, PassThrough, Readable } from 'stream';
import { Logger } from 'pino';
import { Channels, FFmpegArgs, FrameSize, OpusInfo, SamplingRate, StreamGetter, StreamGetterOptions } from './types';
import * as Api from './api';
import fs from 'fs';
import { StabilizeStream, StabilizeStreamOptions } from './utils';

// prettier-ignore
// see page 15 @ https://tools.ietf.org/html/rfc6716#section-3.1
export const FRAME_SIZE_MAP = [
  10, 20, 40, 60, // config 0..3
  10, 20, 40, 60, // config 4..7
  10, 20, 40, 60, // config 8..11
  10, 20, // config 12..13
  10, 20, // config 14..15
  2.5, 5, 10, 20, // config 16..19
  2.5, 5, 10, 20, // config 20..23
  2.5, 5, 10, 20, // config 24..27
  2.5, 5, 10, 20, // config 28..31
];

export type OpusReader = {
  opusInfo: OpusInfo;
  opusStream: PassThrough;
};

export type OpusOptions = {
  bitrateKbps?: number | null;
  channels?: Channels;
  samplingRate?: SamplingRate;
  frameSize?: FrameSize;
};

const DEFAULT_OPTIONS: Required<OpusOptions> = {
  bitrateKbps: null,
  channels: 1,
  samplingRate: 48000,
  frameSize: 20,
};

export async function getOpusReader(
  inputStream: Readable,
  parentLogger: Logger,
  options?: OpusOptions | null,
): Promise<OpusReader> {
  const logger = parentLogger.child({ facility: 'getOpusReader' });
  logger.debug('Setting up OPUS reader');

  const { bitrateKbps, channels, samplingRate, frameSize }: Required<OpusOptions> =
    options != null ? { ...DEFAULT_OPTIONS, ...options } : DEFAULT_OPTIONS;

  //
  // Encode stream
  //
  const encoderOptions = {
    rate: samplingRate,
    channels: channels,
    frameSize: Math.round((frameSize / 1000) * samplingRate),
  };
  logger.info(encoderOptions, 'Encoder options');
  const encodeStream = new prism.opus.Encoder(encoderOptions);
  encodeStream.on('error', function (err: Error) {
    logger.error(err, 'Encode stream error');
    throw err;
  });
  if (bitrateKbps != null) {
    encodeStream.setBitrate(bitrateKbps * 1000);
  }

  const opusInfo: OpusInfo = {
    channels: channels,
    inputSampleRate: samplingRate,

    framesPerPacket: 1,
    frameSize: frameSize,
  };
  logger.debug(opusInfo, 'OPUS info');

  // Starting the stream to read out the metadata
  logger.debug('Piping input stream to the encoder');
  const opusStream = inputStream.pipe(encodeStream);

  return {
    opusInfo,
    opusStream,
  };
}

export type FileStreamOptions = {
  samplingRate?: SamplingRate;
  volumeFactor?: number;
  ffmpegArgs?: FFmpegArgs;
};

const FILE_STREAM_DEFAULT_FFMPEG_ARGS: FFmpegArgs = ['-channel_layout', 'mono'];
const FILE_STREAM_DEFAULT_OPTIONS: Required<FileStreamOptions> = {
  samplingRate: 48000,
  volumeFactor: 0.5,
  ffmpegArgs: FILE_STREAM_DEFAULT_FFMPEG_ARGS,
};

export function initAudioStream(
  event: Api.EventStreamStart,
  opusInfo: OpusInfo,
  opusStream: Readable,
  logger: Logger,
): StreamGetter {
  return (options?: StreamGetterOptions) => {
    // Defaults
    let pcm = true;
    let resample = false;
    let resampleRate = 48000;
    let stabilize = true;
    let stabilizeBufferLength = 1;
    // Tricky options parsing. It's based on the default values above.
    if (options != null && options.pcm !== true) {
      if (options.pcm === false) {
        pcm = false;
      } else {
        if (options.pcm.resample != null && options.pcm.resample !== false) {
          resample = true;
          if (options.pcm.resample !== true) {
            resampleRate = options.pcm.resample;
          }
        }
        if (options.pcm.stabilize != null && options.pcm.stabilize !== true) {
          if (options.pcm.stabilize === false) {
            stabilize = false;
          } else {
            stabilizeBufferLength = options.pcm.stabilize;
          }
        }
      }
    }
    logger.debug({ ...opusInfo, ...event }, 'getStream');
    if (pcm) {
      const frameSize = (opusInfo.inputSampleRate * opusInfo.frameSize) / 1000;
      const opusOpt = {
        rate: opusInfo.inputSampleRate,
        channels: opusInfo.channels,
        frameSize,
      };
      const opusDecoder = new prism.opus.Decoder(opusOpt);

      // Resample stream
      let resampleStream: Duplex | null = null;
      if (resample) {
        const resampleArguments = [
          '-analyzeduration',
          '0',
          '-loglevel',
          '0',
          '-f',
          's16le',
          '-ar',
          opusInfo.inputSampleRate.toString(),
          '-channel_layout',
          'mono',
          '-i',
          '-',
          '-f',
          's16le',
          '-filter:a',
          `aresample=${resampleRate}`,
          '-channel_layout',
          'mono',
        ];
        logger.debug(resampleArguments, 'resampleArguments');
        resampleStream = new prism.FFmpeg({
          args: resampleArguments,
        });
      }

      // Stabilize stream
      let stabilizeStream: Duplex | null = null;
      if (stabilize) {
        const bufferDurationInPackets = Math.round((stabilizeBufferLength * 1000) / event.packet_duration);
        const bufferSize = bufferDurationInPackets * frameSize * opusInfo.framesPerPacket;
        const stabilizeOpt: StabilizeStreamOptions = {
          bufferSize,
          readableHighWaterMark: bufferSize,
          logger,
        };
        stabilizeStream = new StabilizeStream(stabilizeOpt);
        logger.debug(stabilizeOpt, 'stabilizeOpt');
      }

      if (resampleStream != null) {
        if (stabilizeStream != null) {
          return opusStream.pipe(opusDecoder).pipe(resampleStream).pipe(stabilizeStream);
        } else {
          return opusStream.pipe(opusDecoder).pipe(resampleStream);
        }
      } else {
        if (stabilizeStream != null) {
          return opusStream.pipe(opusDecoder).pipe(stabilizeStream);
        } else {
          return opusStream.pipe(opusDecoder);
        }
      }
    } else {
      return opusStream;
    }
  };
}

type AudioFileStreamCtl = {
  stream: Readable;
  close: () => Promise<unknown>;
};

export function getAudioFileStreamCtl(
  path: string,
  parentLogger: Logger,
  options?: FileStreamOptions,
): AudioFileStreamCtl {
  const logger = parentLogger.child({ facility: 'getFileStream' });

  const rs = fs.createReadStream(path);
  rs.on('error', (err) => {
    logger.error(err, 'Read stream error');
    throw err;
  });
  const { samplingRate, volumeFactor, ffmpegArgs }: Required<FileStreamOptions> =
    options != null ? { ...FILE_STREAM_DEFAULT_OPTIONS, ...options } : FILE_STREAM_DEFAULT_OPTIONS;

  // Create transcoder stream
  const transcoderArguments = [
    '-analyzeduration',
    '0',
    '-loglevel',
    '0',
    '-i',
    '-',
    '-f',
    's16le',
    '-filter:a',
    `aresample=${samplingRate},volume=${volumeFactor}`,
    ...ffmpegArgs,
  ];
  const transcodeStream = new prism.FFmpeg({
    args: transcoderArguments,
  });
  logger.debug(transcoderArguments, 'Transcoding arguments');
  // Set error handler on the transcoder stream
  transcodeStream.on('error', function (err: Error) {
    logger.error(err, 'Transcoder stream error');
    throw err;
  });
  return {
    stream: rs.pipe(transcodeStream),
    close: async () => {
      rs.destroy();
      await pEvent(rs, 'close');
    },
  };
}
