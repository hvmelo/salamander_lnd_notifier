import log4js from 'log4js';

log4js.configure({
    appenders: {
      "stdout" : { type: "stdout" },
      "file"   : { type: "file", filename: "logs/lnd_notifier.log", "maxLogSize": 10485760, "numBackups": 3 }
    },
    categories: {
      default:  { appenders: [ 'stdout', 'file' ], level: 'info' },
    }
  });

export const log = log4js.getLogger();

