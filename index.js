import LndGrpc from 'lnd-grpc'
import * as fs from 'fs';
import { MACAROON_PATH, LND_PORT, LND_HOST, TLS_CERT_PATH, PASSWORD_FILE_PATH } from './config.js';
import { log } from './utils/logger.js';

log.info(`Started a new LND notifier instance`);

//process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;

const macaroon = fs.readFileSync(MACAROON_PATH).toString('hex');
const password = fs.readFileSync(PASSWORD_FILE_PATH).toString().replace(/\r?\n|\r/g, '');

const grpc = new LndGrpc({
  host: `${LND_HOST}:${LND_PORT}`,
  cert: TLS_CERT_PATH,
  macaroon: macaroon,
})

log.info(`Attempting to connect to lnd server at ${LND_HOST}:${LND_PORT}...`);

while (grpc.state == 'ready') {
  try {
    await grpc.connect();
    if (grpc.state == 'ready') {
      log.info(`Waiting for server full sync...`);
    }
  }
  catch (error) {
    log.error(`Could't connect to lnd server at ${LND_HOST}:${LND_PORT}. Error message: ${error.message}`);
    process.exit();
  }
}

log.info(`Connection successfully established to lnd server at ${LND_HOST}:${LND_PORT}`);


// Check if the wallet is locked and unlock if needed.
if (grpc.state === 'locked') {
  log.info(`The wallet is locked. Will try to unlock.`);

  const { WalletUnlocker } = grpc.services
  try {
    await WalletUnlocker.unlockWallet({
      wallet_password: Buffer.from(password),
    })
  }
  catch (error) {
    log.error(`Error when trying to unlock the wallet: ${error.message}`);
    process.exit();
  }
  log.info(`Wallet successfully unlocked. Now will try to activate the Lightning service and all of it's subservices`);

  // After unlocking the wallet, activate the Lightning service and all of it's subservices.
  try {
    await grpc.activateLightning()
    log.info(`Successfully activated Lightning after unlocking the wallet`);
  } catch (error) {
    log.error(`An unexpected error occurred when trying to activate the wallet: ${error.message}`);
    process.exit();
  }
}

if (grpc.state == 'active') {
  log.info(`The wallet is unlocked. Trying now to subscribe to transactions services...`);

  const { Lightning } = grpc.services

  try {
    var call = await Lightning.subscribeTransactions();
    log.info(`Successfully subscribed to transactions services. Now listening...`);

    call.on('data', function (transaction) {
      // A response was received from the server.
      log.info(`New wallet event! Transaction with tx_hash: ${transaction.tx_hash}`);
      log.debug(`New transaction: ${transaction}`);
    });

    call.on('status', function (status) {
      log.info(`LND transactions stream status update. Code: ${status.details}. Details: ${status.details}`);
    });

    call.on('end', function () {
      log.info(`LND transactions stream closed by the server`);
    });
  } catch (error) {
    log.error(`An error occurred when trying to subscribe to transactions: ${error.message}`);
  }

}
else {
  log.error("Could't reach an active state for unknown reason. Will abort.");
}




