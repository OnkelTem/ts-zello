import prism from 'prism-media';
import { Duplex, PassThrough, Readable } from 'stream';
import { Logger } from 'pino';
import { Channels, FFmpegArgs, FrameSize, OpusInfo, SamplingRate, StreamGetter, StreamGetterOptions } from './types';
import * as Api from './api';
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

export async function getOpusReader(parentLogger: Logger, options?: OpusOptions | null): Promise<OpusReader> {
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
    channels,
    inputSampleRate: samplingRate,
    framesPerPacket: 1,
    frameSize,
  };
  logger.debug(opusInfo, 'OPUS info');

  return {
    opusInfo,
    opusStream: encodeStream,
  };
}

// http://ffmpeg.org/ffmpeg-utils.html#Time-duration
export type FFmpegDuration = string;

const reFFmpegDuration = /^((\d{2}:)?\d{2}:\d{2}(\.\d+)?|\d+(\.\d+)?(s|ms|us)?)$/gm;

export function isFFmpegDuration(arg: string): arg is FFmpegDuration {
  // Either [-][HH:]MM:SS[.m...] or [-]S+[.m...][s|ms|us]
  return !!arg.match(reFFmpegDuration);
}

export type FFmpegTempo = number;
const FFmpegTempoDefault: FFmpegTempo = 1;

export type FFmpegVolume = number;
const FFmpegVolumeDefault: FFmpegVolume = 1;

export type FFmpegNormalizer = {
  // I, i
  // Set integrated loudness target. Range is -70.0 - -5.0. Default value is -24.0.
  integratedLoudness: number;
  // LRA, lra
  // Set loudness range target. Range is 1.0 - 20.0. Default value is 7.0.
  loudnessRange: number;
  // TP, tp
  // Set maximum true peak. Range is -9.0 - +0.0. Default value is -2.0.
  maximumPeak: number;
};

const FFmpegNormalizerDefaults: FFmpegNormalizer = {
  integratedLoudness: -24.0,
  loudnessRange: 7.0,
  maximumPeak: -2.0,
};

export type FFmpegCompressor = {
  // threshold
  // If a signal of stream rises above this level it will affect the gain reduction. By default it is 0.125. Range is between 0.00097563 and 1.
  threshold: number;
  // ratio
  // Set a ratio by which the signal is reduced. 1:2 means that if the level rose 4dB above the threshold, it will be only 2dB above after the reduction. Default is 2. Range is between 1 and 20.
  ratio: number;
  // attack
  // Amount of milliseconds the signal has to rise above the threshold before gain reduction starts. Default is 20. Range is between 0.01 and 2000.
  attack: number;
  // release
  // Amount of milliseconds the signal has to fall below the threshold before reduction is decreased again. Default is 250. Range is between 0.01 and 9000.
  // threshold=-21dB:ratio=9:attack=200:release=1000
  release: number;
};

const FFmpegCompressorDefaults: FFmpegCompressor = {
  threshold: 0.125,
  ratio: 2,
  attack: 20,
  release: 250,
};

export function isFFmpegTempo(arg: number): arg is FFmpegTempo {
  return arg >= 0.5 && arg <= 2.0;
}

export type FileStreamOptions = {
  samplingRate?: SamplingRate;
  volumeFactor?: FFmpegVolume | null | boolean;
  tempoFactor?: FFmpegTempo | null | boolean;
  normalizer?: FFmpegNormalizer | null | boolean;
  compressor?: FFmpegCompressor | null | boolean;
  startAt?: FFmpegDuration | null;
  endAt?: FFmpegDuration | null;
  ffmpegArgs?: FFmpegArgs;
};

const FILE_STREAM_DEFAULT_FFMPEG_ARGS: FFmpegArgs = ['-channel_layout', 'mono'];
const FILE_STREAM_DEFAULT_OPTIONS: Required<FileStreamOptions> = {
  samplingRate: 48000,
  volumeFactor: null,
  tempoFactor: null,
  normalizer: null,
  compressor: null,
  startAt: null,
  endAt: null,
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

export function getAutoDecodeStream(parentLogger: Logger, options?: FileStreamOptions): Duplex {
  const logger = parentLogger.child({ facility: 'getAutoDecodeStream' });

  const {
    samplingRate,
    volumeFactor,
    tempoFactor,
    normalizer,
    compressor,
    startAt,
    endAt,
    ffmpegArgs,
  }: Required<FileStreamOptions> =
    options != null ? { ...FILE_STREAM_DEFAULT_OPTIONS, ...options } : FILE_STREAM_DEFAULT_OPTIONS;

  // From ... to ...
  let startAtArg: [string, string] | [] = [];
  let endAtArg: [string, string] | [] = [];
  if (startAt != null) {
    if (isFFmpegDuration(startAt)) {
      startAtArg = ['-ss', startAt];
    } else {
      logger.warn(`Wrong startAt format: ${startAt}`);
    }
  }
  if (endAt != null) {
    if (isFFmpegDuration(endAt)) {
      endAtArg = ['-t', endAt];
    } else {
      logger.warn(`Wrong endAt format: ${endAt}`);
    }
  }

  const filters: string[] = [];
  if (compressor != null && compressor !== false) {
    let c: FFmpegCompressor;
    if (compressor === true) {
      // use defaults
      c = FFmpegCompressorDefaults;
    } else {
      // merge with defaults
      c = { ...compressor, ...FFmpegCompressorDefaults };
    }
    filters.push(`acompressor=threshold=${c.threshold}:ratio=${c.ratio}:attack=${c.attack}:release=${c.release}`);
  }

  if (normalizer != null && normalizer !== false) {
    let n: FFmpegNormalizer;
    if (normalizer === true) {
      // use defaults
      n = FFmpegNormalizerDefaults;
    } else {
      // merge with defaults
      n = { ...normalizer, ...FFmpegNormalizerDefaults };
    }
    filters.push(`loudnorm=i=${n.integratedLoudness}:lra=${n.loudnessRange}:tp=${n.maximumPeak}`);
  }

  filters.push(`aresample=${samplingRate}`);

  if (volumeFactor != null && volumeFactor !== false) {
    let v: FFmpegVolume;
    if (volumeFactor === true) {
      // use default
      v = FFmpegVolumeDefault;
    } else {
      v = volumeFactor;
    }
    filters.push(`volume=${v}`);
  }
  if (tempoFactor != null && tempoFactor !== false) {
    let t: FFmpegTempo;
    if (tempoFactor === true) {
      // use default
      t = FFmpegTempoDefault;
    } else {
      t = tempoFactor;
    }
    if (isFFmpegTempo(t)) {
      filters.push(`atempo=${t}`);
    } else {
      logger.warn(`Ignoring non-valid volume parameter: ${t}`);
    }
  }

  // Create transcoder stream
  const transcoderArguments = [
    '-analyzeduration',
    '0',
    '-loglevel',
    '0',
    '-i',
    '-',
    ...startAtArg,
    ...endAtArg,
    '-f',
    's16le',
    '-filter:a',
    filters.join(','),
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
  return transcodeStream;
}
