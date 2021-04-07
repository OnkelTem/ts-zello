import * as Api from '../api';
import { Macro } from '../types';

const DEFAULT_LOGIN_TIMEOUT = 8;

function checkCredentials(cred: any) {
  return !(cred == null || typeof cred != 'object' || cred.auth_token == null || cred.channel == null);
}

type Login = (cred: Omit<Api.CommandLogonRequest, 'command'>, timeout?: number) => Promise<Api.CommandLogonResponse>;

const login: Macro<Login> = function ({ commands, logger, awaits }) {
  return async function (cred, timeout = DEFAULT_LOGIN_TIMEOUT) {
    logger.debug('Logging in...');
    if (!checkCredentials(cred)) {
      throw new Error('Check credentials');
    }
    const [resp] = await Promise.all([
      commands.logon(cred, timeout).then((resp) => {
        if (resp.error != null) {
          throw new Error(resp.error);
        }
        const isAuthorized = resp.success != null && resp.success && resp.refresh_token != null;
        if (!isAuthorized) {
          throw new Error('authorization failed');
        }
        return resp;
      }),
      awaits.onChannelStatus(true, timeout).then((channelStatus) => {
        if (channelStatus.status !== 'online') {
          throw new Error('channel not available');
        }
      }),
    ]);
    logger.info(`Successfully logged in to channel "${cred.channel}"`);
    return resp;
  };
};

export default login;
