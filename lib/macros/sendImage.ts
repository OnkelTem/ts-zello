import { OpusOptions } from '../audio';
import * as Api from '../api';
import { Macro } from '../types';
import { getImageReader } from '../image';

type Options = {
  transcode?: OpusOptions;
};

type SendImage = (inputData: Buffer, options?: Options) => Promise<any>;

const sendImage: Macro<SendImage> = function ({ commands, logger }) {
  return async function (imageData: Buffer) {
    const { imageInfo, fullSizeData, thumbnailData } = await getImageReader(imageData);
    let resp: Api.CommandSendImageResponse;
    try {
      resp = await commands.sendImage({
        content_length: imageInfo.length,
        thumbnail_content_length: imageInfo.thumbnail_length,
        width: imageInfo.width,
        height: imageInfo.height,
        type: Api.ImageTypes.JPEG,
        source: Api.ImageSources.LIBRARY,
      });
    } catch (err) {
      throw new Error(err);
    }
    logger.debug(`image_id: ${resp.image_id}`);
    logger.info('Sending image...');
    const sendImage = await commands.sendImageData({
      imageId: resp.image_id,
      fullSizeData,
      thumbnailData,
    });
    await sendImage();
    logger.info('Image sent.');
  };
};

export default sendImage;
