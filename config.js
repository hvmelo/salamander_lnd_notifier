import { log as logger }  from './utils/logger.js';

const DEFAULT_HOST = "localhost";
const DEFAULT_PORT = "10009";
const DEFAULT_MACAROON_PATH = "/home/.lnd_notifier/admin.macaroon";
const DEFAULT_TLS_CERT_PATH = "/home/.lnd_notifier/tls.cert";
const DEFAULT_PASSWORD_FILE_PATH = "/home/.lnd_notifier/lnd.passwd";

//const DEFAULT_MACAROON_PATH = "/Users/hvmelo/lnd/admin.macaroon";
//const DEFAULT_TLS_CERT_PATH = "/Users/hvmelo/lnd/tls.cert";
//const DEFAULT_PASSWORD_FILE_PATH = "/Users/hvmelo/lnd/lnd.passwd";

// const DEFAULT_HOST = "salamanderlnd.ddns.net";
// const DEFAULT_PORT = "10009";
// const DEFAULT_MACAROON_PATH = "/Users/hvmelo/lnd/remote/admin.macaroon";
// const DEFAULT_TLS_CERT_PATH = "/Users/hvmelo/lnd/remote/tls.cert";
// const DEFAULT_PASSWORD_FILE_PATH = "/Users/hvmelo/lnd/remote/lnd.passwd";

export const LND_HOST = process.env.LND_HOST ? process.env.LND_HOST : DEFAULT_HOST;
export const LND_PORT = process.env.LND_PORT ? process.env.LND_PORT : DEFAULT_PORT;
export const MACAROON_PATH = process.env.MACAROON_PATH ? process.env.MACAROON_PATH : DEFAULT_MACAROON_PATH;
export const TLS_CERT_PATH = process.env.TLS_CERT_PATH ? process.env.TLS_CERT_PATH : DEFAULT_TLS_CERT_PATH;
export const PASSWORD_FILE_PATH = process.env.PASSWORD_FILE_PATH ? process.env.PASSWORD_FILE_PATH : DEFAULT_PASSWORD_FILE_PATH;


function handle(signal) {
    logger.info(`Received event: ${signal}`)
 }
 process.on('SIGHUP', handle)

 async function closeGracefully(signal) {
    logger.info(`Received signal to terminate: ${signal}`)
    process.exit()
 }
 process.on('SIGINT', closeGracefully)
 process.on('SIGTERM', closeGracefully)





