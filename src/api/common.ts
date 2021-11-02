export enum StreamTypes {
  AUDIO = 'audio',
}
export const streamTypes = [StreamTypes.AUDIO] as const;
export type StreamType = typeof streamTypes[number];

export enum Codecs {
  OPUS = 'opus',
}
export const codecs = [Codecs.OPUS] as const;
export type Codec = typeof codecs[number];

export enum ImageTypes {
  JPEG = 'jpeg',
}
export const imageTypes = [ImageTypes.JPEG] as const;
export type ImageType = typeof imageTypes[number];

export enum ImageSources {
  CAMERA = 'camera',
  LIBRARY = 'library',
}
export const imageSources = [ImageSources.CAMERA, ImageSources.LIBRARY] as const;
export type ImageSource = typeof imageSources[number];
