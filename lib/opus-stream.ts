import prism from 'prism-media';
import pEvent from 'p-event';
import { PassThrough, Readable } from 'stream';
import { Logger } from 'pino';

// prettier-ignore
// see page 15 @ https://tools.ietf.org/html/rfc6716#section-3.1
const FRAME_SIZE_MAP = [
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

export type OpusInfo = {
  channels: number;
  inputSampleRate: number;
  framesPerPacket: number;
  frameSize: number;
};

export type OpusReader = {
  opusInfo: OpusInfo;
  opusStream: PassThrough;
};

type FFmpegArgs = string[];

export type TranscodingOptions = {
  bitrateKbps?: number;
  // e.g.: ['-filter:a', 'volume=0.6']
  ffmpegArgs?: FFmpegArgs | ((args: FFmpegArgs) => FFmpegArgs);
};

const DEFAULT_FFMPEG_ARGS: FFmpegArgs = ['-channel_layout', 'stereo'];

export async function getOpusReader(
  inputStream: Readable,
  parentLogger: Logger,
  options?: TranscodingOptions | null,
): Promise<OpusReader> {
  const logger = parentLogger.child({ facility: 'getOpusReader' });
  logger.debug('Setting up OPUS reader');
  //
  // Input stream
  //
  // Set error handler on the input stream
  inputStream.on('error', function (err: Error) {
    logger.error(err, 'Input stream error');
    throw err;
  });

  //
  // Transcoder stream
  //
  const { bitrateKbps, ffmpegArgs }: TranscodingOptions = options != null ? options : {};
  // Create transcoder stream
  const transcoderArguments = [
    '-analyzeduration',
    '0',
    '-loglevel',
    '0',
    '-f',
    'opus',
    ...(bitrateKbps != null ? ['-b:a', bitrateKbps + 'K'] : []),
    ...(ffmpegArgs != null
      ? typeof ffmpegArgs === 'function'
        ? ffmpegArgs(DEFAULT_FFMPEG_ARGS)
        : ffmpegArgs
      : DEFAULT_FFMPEG_ARGS),
  ];
  logger.debug(transcoderArguments, 'Transcoder arguments');
  const transcoderStream = new prism.FFmpeg({
    args: transcoderArguments,
  });
  // Set error handler on the transcoder stream
  transcoderStream.on('error', function (err: Error) {
    logger.error(err, 'Transcoder stream error');
    throw err;
  });

  //
  // Demux stream
  //
  // Create demux stream
  const demuxStream = new prism.opus.OggDemuxer();
  // Set error handler on the transcoder stream
  demuxStream.on('error', function (err: Error) {
    logger.error(err, 'Demux stream error');
    throw err;
  });

  // Read 'head' and 'data' event promises.

  const headPromise = pEvent(demuxStream, 'head').then((buf: Buffer) => {
    const head = {
      channels: buf.readUInt8(9), // e.g. 2
      inputSampleRate: buf.readUInt32LE(12), // e.g. 24000
    };
    logger.debug(head, 'OPUS info/head');
    return head;
  });

  const dataPromise = pEvent(demuxStream, 'data').then((buf: Buffer) => {
    const toc = buf.readUInt8(0);
    const config = (toc & 0b11111000) >> 3;
    //const s = (toc & 0b00000100) >> 2;
    const c = toc & 0b00000011;
    if (c > 2) {
      logger.warn('An arbitrary number of frames in the packet - possible audio artifacts');
    }
    const packetInfo = {
      framesPerPacket: c === 0 ? 1 : c === 1 || c === 2 ? 2 : 1,
      frameSize: FRAME_SIZE_MAP[config],
    };
    logger.debug(packetInfo, 'OPUS info/data');
    return packetInfo;
  });

  // Composite promise to read metadata
  const opusInfoPromise = Promise.all([headPromise, dataPromise]).then((parts) => ({
    ...parts[0],
    ...parts[1],
  }));

  // Starting the stream to read out the metadata
  logger.debug('Running OPUS stream pipe');
  const opusStream = inputStream.pipe(transcoderStream).pipe(demuxStream).pipe(new PassThrough());

  // Actually resolve metadata promise
  logger.debug('Fetching OPUS info');
  const opusInfo: OpusInfo = await opusInfoPromise;

  return {
    opusInfo,
    opusStream,
  };
}
