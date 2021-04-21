import login from './login';
import sendAudio from './sendAudio';
import sendImage from './sendImage';
import { Macro, ZelloMacro } from '../types';

function setMacroHandler<T>(macro: Macro<T>, props: ZelloMacro) {
  return macro(props);
}

function getMacros(props: ZelloMacro) {
  return {
    login: setMacroHandler(login, props),
    sendAudio: setMacroHandler(sendAudio, props),
    sendImage: setMacroHandler(sendImage, props),
  };
}

export { getMacros };
