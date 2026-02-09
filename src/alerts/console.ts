import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('alerts');

export interface AlertMessage {
  severity: 'info' | 'warn' | 'error';
  title: string;
  body: string;
}

export function sendConsoleAlert(msg: AlertMessage): void {
  switch (msg.severity) {
    case 'info':
      log.info(msg.title + ' — ' + msg.body);
      break;
    case 'warn':
      log.warn(msg.title + ' — ' + msg.body);
      break;
    case 'error':
      log.error(msg.title + ' — ' + msg.body);
      break;
  }
}
