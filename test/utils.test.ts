import * as utils from '../lib/utils';
import * as Api from '../lib/api';

test('test packet pack', () => {
  const buf = Buffer.from(new Uint8Array([1, 2, 3]));
  const expected = [1, 0, 0, 1, 0, 0, 0, 0, 1, 1, 2, 3];
  const packed = utils.packPacket({
    data: buf,
    type: 1, // Audio
    streamId: 256,
    packetId: 1,
  });
  expect(packed).not.toBeNull();
  expect([...packed!]).toMatchObject(expected);
});

test('test packet unpack', () => {
  const buf = Buffer.from(new Uint8Array([1, 0, 0, 1, 0, 0, 0, 0, 1, 1, 2, 3]));
  const unpacked = utils.unpackPacket(buf);
  const expected: Api.PacketAudio = {
    data: Buffer.from(new Uint8Array([1, 2, 3])),
    type: 1, // Audio
    streamId: 256,
    packetId: 1,
  };
  expect(unpacked).toMatchObject(expected);
});

test('test packet pack(unpack)', () => {
  const packet = {
    data: Buffer.from(new Uint8Array([1, 2, 3])),
    type: 1, // Audio
    streamId: 256,
    packetId: 1,
  };
  expect(utils.unpackPacket(utils.packPacket(packet))).toMatchObject(packet);
});

test('test codec header encode', () => {
  expect(
    utils.encodeCodecHeader({
      inputSampleRate: 48000,
      framesPerPacket: 1,
      frameSize: 20,
      channels: 1,
    }),
  ).toBe('gLsBFA==');
});

test('test codec header decode', () => {
  expect(utils.decodeCodecHeader('gD4BPA==')).toMatchObject({
    inputSampleRate: 16000,
    framesPerPacket: 1,
    frameSize: 60,
    channels: 1,
  });
});

test('test toCamel() converter', () => {
  expect(utils.toCamel('on_channel_status')).toBe('onChannelStatus');
});
