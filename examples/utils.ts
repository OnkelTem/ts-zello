import { Duplex, Transform, Writable } from 'stream';
import { CommandLogonRequest, FRAME_SIZE_MAP } from '../lib';
import { Logger } from 'pino';
import { readFileSync } from 'fs';

const raw = readFileSync('examples/credentials.json', 'utf8');
const data = JSON.parse(raw);
export const cred1: CommandLogonRequest = data[0];
export const cred2: CommandLogonRequest = data[1];

function getTime() {
  return process.hrtime.bigint();
}

export type PacketsStat = { delay: number; size: number }[];

export function getPacketsStatsStream(label: string, enabled: boolean = true, logger: Logger): Duplex {
  const packetsStat: PacketsStat = [];
  let lastTime: bigint;
  const statsStream = new Transform({
    transform(chunk, encoding, callback) {
      const buf = chunk as Buffer;
      if (enabled) {
        const delay = lastTime != null ? Math.round(Number(getTime() - lastTime) / 1000000) : 0;
        logger.info(`${label}:\t${buf.length.toString().padStart(5, ' ')}\t${delay.toString().padStart(4, ' ')} ms`);
        packetsStat.push({ delay, size: buf.length });
      }
      this.push(chunk);
      callback();
      if (enabled) {
        lastTime = getTime();
      }
    },
    flush(callback) {
      callback();
    },
  });
  function showStats() {
    logger.info(
      {
        avgPacketDuration: Math.round(packetsStat.reduce((a, b) => a + b.delay, 0) / packetsStat.length),
        avgPacketSize: Math.round(packetsStat.reduce((a, b) => a + b.size, 0) / packetsStat.length),
        totalSize: packetsStat.reduce((sum, v) => {
          sum = sum + v.size;
          return sum;
        }, 0),
        totalNum: packetsStat.length,
      },
      'Packet stats',
    );
  }
  process.on('exit', showStats);
  return statsStream;
}

export function getOpusStatsStream(logger: Logger): Duplex {
  let size = 0;
  let startTime: bigint;
  return new Transform({
    // readableHighWaterMark: 0,
    // writableHighWaterMark: 0,
    transform(chunk, encoding, callback) {
      const buf = chunk as Buffer;
      size += buf.length;
      const toc = buf.readUInt8(0);
      const config = (toc & 0b11111000) >> 3;
      const c = toc & 0b00000011;
      let bitrate: number = 0;
      if (startTime == null) {
        startTime = getTime();
      } else {
        bitrate = (size / (Number(getTime() - startTime) / 1000000)) * 1000;
      }
      const info = [
        bitrate,
        c === 0 ? '1 fpp' : c === 1 ? '2 fpp-eq' : c === 2 ? '2 fpp-df' : '? fpp',
        FRAME_SIZE_MAP[config],
      ];
      logger.info(info, 'packet');
      this.push(chunk);
      callback();
    },
    flush(callback) {
      callback();
    },
  });
}

export function getBitrateStatsStream(period: number, logger: Logger): Duplex {
  let size = 0;
  let periodStart: bigint;
  return new Transform({
    transform(chunk, encoding, callback) {
      const buf = chunk as Buffer;
      size += buf.length;
      const now = getTime();
      if (periodStart == null) {
        periodStart = now;
      }
      const periodDiffMs = Number(now - periodStart) / 1000000;
      if (periodDiffMs >= period * 1000) {
        const bitrate = Math.round(((size * 8) / periodDiffMs) * 1000);
        logger.info(`bitrate:\t${bitrate}`);
        periodStart = now;
        size = 0;
      }
      this.push(chunk);
      callback();
    },
    flush(callback) {
      callback();
    },
  });
}

export function getDevNullStream(): Writable {
  return new Writable({
    write(chunk, encoding, callback) {
      callback();
    },
  });
}
