import { DeferredPromise, OpusInfo } from './types';
import * as Api from './api';
import { Logger } from 'pino';
import { Duplex, DuplexOptions, Transform, TransformCallback, TransformOptions } from 'stream';

export function encodeCodecHeader(opusInfo: OpusInfo) {
  const buf = Buffer.alloc(4);
  buf.writeUInt16LE(opusInfo.inputSampleRate, 0);
  buf.writeUInt8(opusInfo.framesPerPacket, 2);
  buf.writeUInt8(opusInfo.frameSize, 3);
  return buf.toString('base64');
}

export function decodeCodecHeader(codecHeader: string): OpusInfo {
  const buf = Buffer.alloc(11, codecHeader, 'base64');
  return {
    inputSampleRate: buf.readUInt16LE(0),
    framesPerPacket: buf.readUInt8(2),
    frameSize: buf.readUInt8(3),
    channels: Api.AUDIO_MAX_CHANNELS,
  };
}

export function packPacket(packet: Api.Packet): Buffer {
  if (Api.isPacketAudio(packet)) {
    const { data, streamId, packetId } = packet;
    const buf = Buffer.concat([Buffer.alloc(9), data]);
    buf.writeUInt8(Api.PacketTypes.AUDIO);
    buf.writeUInt32BE(streamId, 1);
    buf.writeUInt32BE(packetId, 5);
    return buf;
  }
  if (Api.isPacketImage(packet)) {
    const { data, imageId, packetType } = packet;
    const buf = Buffer.concat([Buffer.alloc(9), data]);
    buf.writeUInt8(Api.PacketTypes.IMAGE);
    buf.writeUInt32BE(imageId, 1);
    buf.writeUInt32BE(packetType, 5);
    return buf;
  }
  throw new Error('Unknown packet type');
}

export function unpackPacket(data?: Buffer): Api.Packet | undefined {
  if (data != null && data.length > 0) {
    if (data[0] === Api.PacketTypes.AUDIO) {
      return {
        type: Api.PacketTypes.AUDIO,
        streamId: data.readUInt32BE(1),
        packetId: data.readUInt32BE(5),
        data: data.slice(9),
      };
    } else if (data[0] === Api.PacketTypes.IMAGE) {
      return {
        type: Api.PacketTypes.IMAGE,
        imageId: data.readUInt32BE(1),
        packetType: data.readUInt32BE(5),
        data: data.slice(9),
      };
    } else {
      // Unknown packet
      return {
        type: Api.PacketTypes.UNKNOWN,
        data,
      };
    }
  }
}

export function getTime() {
  return process.hrtime.bigint();
}

export function isEnvVar(envVar: any): boolean {
  return envVar != null && envVar !== '' && envVar !== 'false' && envVar !== '0' && envVar !== 'none';
}

export type StabilizeStreamOptions = DuplexOptions & {
  bufferSize: number;
  logger: Logger;
};

export class StabilizeStream extends Duplex {
  queue: Buffer[];
  logger: Logger;
  queueSize: number;
  requestedSize: number;
  queueMaxSize: number;
  waiting: boolean = false;
  deferredWritePromise?: DeferredPromise<number>;

  constructor(opts: StabilizeStreamOptions) {
    super(opts);
    this.logger = opts.logger.child({ facility: 'StabilizeStream' });
    this.queueMaxSize = opts.bufferSize;
    if (this.readableHighWaterMark > this.queueMaxSize) {
      this.queueMaxSize = this.readableHighWaterMark;
      this.logger.debug('bufferSize is automatically increased up to readableHighWaterMark');
    }
    this.queue = [];
    this.queueSize = 0;
    this.requestedSize = 0;
  }

  /**
   * Read data from the internal queue and send it further
   */
  realRead() {
    this.logger.trace('realRead()');
    let index = 0;
    let replySize = 0;
    for (let i = 0; i < this.queue.length; i++) {
      if (replySize + this.queue[i].length > this.requestedSize) {
        break;
      }
      index++;
      replySize += this.queue[i].length;
    }
    let slice: Buffer | null = null;
    // First check the last element boundary
    if (replySize < this.requestedSize && this.queueMaxSize >= this.requestedSize) {
      const diff = this.requestedSize - replySize;
      // Slice the last element
      slice = this.queue[index].slice(0, diff);
      // Mutate the last element
      this.queue[index] = this.queue[index].slice(diff);
      // Update the queue size counter
      this.queueSize = this.queueSize - diff;
    }
    // Mutate the queue, fetching out reply
    const queueFetched = this.queue.splice(0, index);
    // Update the queue size counter
    this.queueSize = this.queueSize - replySize;
    // Check if we have a slice and update the fetched queue
    if (slice != null) {
      queueFetched.push(slice);
    }
    const reply = Buffer.concat(queueFetched);
    // Reset requestedSize
    this.requestedSize = 0;
    this.waiting = false;
    this.logger.trace({ replyLength: reply.length }, 'realRead(): push');
    this.push(reply);
  }

  async _write(chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    // TODO: что насчет encoding?
    // TODO: что насчет не буферов?
    if (Buffer.isBuffer(chunk)) {
      this.logger.trace({ chunkSize: chunk.length }, '_write()');
      // Write the arrived chunk to the queue
      this.queue.push(chunk);
      // Update the queue size counter
      this.queueSize += chunk.length;
      // Report to the upstream that we're done
      this.logger.trace({ queueSize: this.queueSize }, '_write(): queued');
      // Check if the buffer is overflowed
      if (this.queueSize >= this.queueMaxSize) {
        this.logger.trace({ size: this.queueSize }, '_write(): writableHighWaterMark reached');
        // Yes, we've reached the point
        // If data were requested to this point, we should read it and update the queue
        if (this.requestedSize > 0) {
          // Actually reading and sending data with the queue updating
          this.realRead();
          callback();
        } else {
          this.logger.trace('_write(): nothing requested yet, pausing');
          this.waiting = true;
          // Since we haven't been requested anything, just save the chunk to overflow
          this.logger.trace('_write(): creating writePromise');
          const writePromise = new Promise<number>((resolve) => {
            this.deferredWritePromise = { resolve };
          });
          this.logger.trace('_write(): start waiting for writePromise');
          await writePromise;

          this.logger.trace('_write(): writePromise resolved!');
          callback();
        }
      } else {
        // Queue is not filled yet (this.queueSize < this.queueMaxSize)
        callback();
      }
    } else {
      callback(new Error('StabilizeStream can process buffers only'));
    }
  }

  _read(size: number) {
    this.logger.trace({ size }, '_read()');
    // Save the requested chunk size
    this.requestedSize = size;
    // If we're on pause, trigger read and unpause writer
    // It's assumed that if overflow is not empty, the writable is paused
    if (this.waiting) {
      this.logger.trace('_read(): read while waiting');
      this.realRead();
      if (this.deferredWritePromise != null) {
        this.logger.trace('_read(): resolving the write promise');
        this.deferredWritePromise.resolve(1);
      }
    }
  }

  _final(callback: (error?: Error | null) => void) {
    const reply = Buffer.concat(this.queue);
    this.push(reply);
    callback();
  }
}

export type DataWaitPassThroughStreamOptions = TransformOptions;

export class DataWaitPassThroughStream extends Transform {
  dataIsReady: boolean = false;

  constructor(opts?: DataWaitPassThroughStreamOptions) {
    super(opts);
  }

  _transform(chunk: any, encoding: BufferEncoding, callback: TransformCallback) {
    if (!this.dataIsReady) {
      this.dataIsReady = true;
      this.emit('dataIsReady');
    }
    callback(null, chunk);
  }
}
