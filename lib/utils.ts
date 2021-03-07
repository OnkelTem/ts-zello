import { OpusInfo } from './opus-stream';
import * as Api from './api';

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

export function packPacket(packet?: Api.Packet): Buffer | undefined {
  if (packet != null) {
    if (Api.isPacketAudio(packet)) {
      const { data, streamId, packetId } = packet;
      const buf = Buffer.concat([Buffer.alloc(9), data]);
      buf.writeUInt8(Api.PacketTypes.AUDIO);
      buf.writeUInt32BE(streamId, 1);
      buf.writeUInt32BE(packetId, 5);
      return buf;
    }
  }
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
        messageId: data.readUInt32BE(1),
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

export function delay(ms: number) {
  return new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms));
}

export function getTime() {
  return process.hrtime.bigint();
}

export function toCamel(s: string) {
  return s.replace(/_([a-z])/g, function (g) {
    return g[1].toUpperCase();
  });
}
