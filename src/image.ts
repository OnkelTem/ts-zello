import sharp from 'sharp';

export type ImageInfo = {
  width: number;
  height: number;
  length: number;
  thumbnail_length: number;
};

export type ImageReader = {
  imageInfo: ImageInfo;
  fullSizeData: Buffer;
  thumbnailData: Buffer;
};

export async function getImageReader(imageData: Buffer): Promise<ImageReader> {
  try {
    const image = sharp(imageData);
    const thumbnailData = await image.resize({ width: 100 }).toFormat('jpeg').toBuffer();
    const fullSizeData = await image.resize({ width: 1000 }).toFormat('jpeg').toBuffer();

    const thumbnailInfo = await sharp(thumbnailData).metadata();
    const fullSizeInfo = await sharp(fullSizeData).metadata();

    if (
      thumbnailInfo.size != null &&
      fullSizeInfo.size != null &&
      fullSizeInfo.width != null &&
      fullSizeInfo.height != null
    ) {
      const imageInfo: ImageInfo = {
        width: fullSizeInfo.width,
        height: fullSizeInfo.height,
        length: thumbnailInfo.size,
        thumbnail_length: fullSizeInfo.size,
      };

      return {
        imageInfo,
        fullSizeData,
        thumbnailData,
      };
    }
  } catch (err) {
    throw new Error(err);
  }
  throw new Error('Cannot process image');
}
