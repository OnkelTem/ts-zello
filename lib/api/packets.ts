enum PacketTypes {
  UNKNOWN = 0,
  AUDIO = 1,
  IMAGE = 2,
}

interface PacketBase {
  type: PacketTypes;
  data: Buffer;
}

interface PacketAudio extends PacketBase {
  type: PacketTypes.AUDIO;
  streamId: number;
  packetId: number;
}

interface PacketImage extends PacketBase {
  type: PacketTypes.IMAGE;
  messageId: number;
}

interface PacketUnknown extends PacketBase {
  type: PacketTypes.UNKNOWN;
}

type Packet = PacketAudio | PacketImage | PacketUnknown;

function isPacketAudio(arg: Packet): arg is PacketAudio {
  return arg.type === PacketTypes.AUDIO;
}

function isPacketImage(arg: Packet): arg is PacketImage {
  return arg.type === PacketTypes.IMAGE;
}

export { Packet, isPacketAudio, isPacketImage, PacketTypes, PacketAudio };
