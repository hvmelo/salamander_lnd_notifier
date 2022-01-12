"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _events = _interopRequireDefault(require("events"));

var _javascriptStateMachine = _interopRequireDefault(require("javascript-state-machine"));

var _debug = _interopRequireDefault(require("debug"));

var _parse = _interopRequireDefault(require("lndconnect/parse"));

var _grpcJs = require("@grpc/grpc-js");

var _utils = require("./utils");

var _services = require("./services");

var _registry = _interopRequireDefault(require("./registry"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function"); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, writable: true, configurable: true } }); if (superClass) _setPrototypeOf(subClass, superClass); }

function _setPrototypeOf(o, p) { _setPrototypeOf = Object.setPrototypeOf || function _setPrototypeOf(o, p) { o.__proto__ = p; return o; }; return _setPrototypeOf(o, p); }

function _createSuper(Derived) { var hasNativeReflectConstruct = _isNativeReflectConstruct(); return function _createSuperInternal() { var Super = _getPrototypeOf(Derived), result; if (hasNativeReflectConstruct) { var NewTarget = _getPrototypeOf(this).constructor; result = Reflect.construct(Super, arguments, NewTarget); } else { result = Super.apply(this, arguments); } return _possibleConstructorReturn(this, result); }; }

function _possibleConstructorReturn(self, call) { if (call && (typeof call === "object" || typeof call === "function")) { return call; } else if (call !== void 0) { throw new TypeError("Derived constructors may only return object or undefined"); } return _assertThisInitialized(self); }

function _assertThisInitialized(self) { if (self === void 0) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return self; }

function _isNativeReflectConstruct() { if (typeof Reflect === "undefined" || !Reflect.construct) return false; if (Reflect.construct.sham) return false; if (typeof Proxy === "function") return true; try { Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function () {})); return true; } catch (e) { return false; } }

function _getPrototypeOf(o) { _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf : function _getPrototypeOf(o) { return o.__proto__ || Object.getPrototypeOf(o); }; return _getPrototypeOf(o); }

const debug = (0, _debug.default)('lnrpc:grpc'); // Set up SSL with the cypher suits that we need.

if (!process.env.GRPC_SSL_CIPHER_SUITES) {
  process.env.GRPC_SSL_CIPHER_SUITES = _utils.grpcSslCipherSuites;
}
/**
 * Lnd gRPC service wrapper.
 * @extends EventEmitter
 */


let LndGrpc = /*#__PURE__*/function (_EventEmitter) {
  _inherits(LndGrpc, _EventEmitter);

  var _super = _createSuper(LndGrpc);

  function LndGrpc(options = {}) {
    var _this;

    _classCallCheck(this, LndGrpc);

    _this = _super.call(this);
    debug(`Initializing LndGrpc with config: %o`, options);
    _this.options = options; // If an lndconnect uri was provided, extract the connection details from that.

    if (options.lndconnectUri) {
      const connectionInfo = (0, _parse.default)(options.lndconnectUri);
      Object.assign(_this.options, connectionInfo);
    } // Define state machine.


    _this.fsm = new _javascriptStateMachine.default({
      init: 'ready',
      transitions: [{
        name: 'activateWalletUnlocker',
        from: ['ready', 'active'],
        to: 'locked'
      }, {
        name: 'activateLightning',
        from: ['ready', 'locked'],
        to: 'active'
      }, {
        name: 'disconnect',
        from: ['locked', 'active'],
        to: 'ready'
      }],
      methods: {
        onBeforeActivateWalletUnlocker: _this.onBeforeActivateWalletUnlocker.bind(_assertThisInitialized(_this)),
        onBeforeActivateLightning: _this.onBeforeActivateLightning.bind(_assertThisInitialized(_this)),
        onBeforeDisconnect: _this.onBeforeDisconnect.bind(_assertThisInitialized(_this)),
        onAfterDisconnect: _this.onAfterDisconnect.bind(_assertThisInitialized(_this)),
        onInvalidTransition: _utils.onInvalidTransition,
        onPendingTransition: _utils.onPendingTransition
      },

      onInvalidTransition(transition, from, to) {
        throw Object.assign(new Error(`transition is invalid in current state`), {
          transition,
          from,
          to
        });
      }

    }); // Define services.

    _this.supportedServices = [_services.WalletUnlocker, _services.Lightning, _services.Autopilot, _services.ChainNotifier, _services.Invoices, _services.Router, _services.Signer, _services.State, _services.Versioner, _services.WalletKit, _services.Watchtower, _services.WatchtowerClient];
    _this.services = {};
    _this.tor = (0, _utils.tor)(); // Instantiate services.

    _this.supportedServices.forEach(Service => {
      const instance = new Service(_this.options);
      _this.services[instance.serviceName] = instance;
    });

    return _this;
  } // ------------------------------------
  // FSM Proxies
  // ------------------------------------


  _createClass(LndGrpc, [{
    key: "is",
    value: function is(...args) {
      return this.fsm.is(...args);
    }
  }, {
    key: "can",
    value: function can(...args) {
      return this.fsm.can(...args);
    }
  }, {
    key: "observe",
    value: function observe(...args) {
      return this.fsm.observe(...args);
    }
  }, {
    key: "state",
    get: function () {
      return this.fsm.state;
    }
  }, {
    key: "connect",
    value: async function connect() {
      debug(`Connecting to lnd gRPC service`); // Verify that the host is valid.

      const host = this.options.host;
      await (0, _utils.validateHost)(host); // Start tor service if needed.

      if ((0, _utils.isTor)(host) && !this.tor.isStarted()) {
        this.emit('tor.starting');
        await this.tor.start();
        this.emit('tor.started');
      } // For lnd >= 0.13.*, the state service is available which provides with
      // the wallet state. For lower version of lnd continue to use WalletUnlocker
      // error codes


      let walletState;
      this.isStateServiceAvailable = false;

      try {
        // Subscribe to wallet state and get current state
        let _await$this$getWallet = await this.getWalletState(),
            state = _await$this$getWallet.state;

        if (state == 'WAITING_TO_START') {
          state = await this.checkWalletState(['NON_EXISTING', 'LOCKED']);
        }

        switch (state) {
          case 'NON_EXISTING':
          case 'LOCKED':
            walletState = _utils.WALLET_STATE_LOCKED;
            break;

          case 'UNLOCKED':
            // Do nothing.
            break;

          case 'RPC_ACTIVE':
          case 'SERVER_ACTIVE':
            walletState = _utils.WALLET_STATE_ACTIVE;
            break;
        }

        this.isStateServiceAvailable = true;
      } catch (error) {
        if (error.code === _grpcJs.status.UNIMPLEMENTED) {
          // Probe the services to determine the wallet state.
          walletState = await this.determineWalletState();
        }
      }

      switch (walletState) {
        case _utils.WALLET_STATE_LOCKED:
          await this.activateWalletUnlocker();
          break;

        case _utils.WALLET_STATE_ACTIVE:
          await this.activateLightning();
          break;
      }
    }
  }, {
    key: "activateWalletUnlocker",
    value: async function activateWalletUnlocker(...args) {
      await this.fsm.activateWalletUnlocker(...args);
      this.emit('locked');
    }
  }, {
    key: "activateLightning",
    value: async function activateLightning(...args) {
      try {
        await this.fsm.activateLightning(...args);
        this.emit('active');
      } catch (e) {
        await this.disconnectAll();
        throw e;
      }
    }
  }, {
    key: "disconnect",
    value: async function disconnect(...args) {
      if (this.can('disconnect')) {
        await this.fsm.disconnect(...args);
      }

      if (this.tor.isStarted()) {
        this.emit('tor.stopping');
        await this.tor.stop();
        this.emit('tor.stopped');
      }

      this.emit('disconnected');
    } // ------------------------------------
    // FSM Observers
    // ------------------------------------

    /**
     * Disconnect from the gRPC service.
     */

  }, {
    key: "onBeforeDisconnect",
    value: async function onBeforeDisconnect() {
      debug(`Disconnecting from lnd gRPC service`);
      await this.disconnectAll();
    }
    /**
     * Log successful disconnect.
     */

  }, {
    key: "onAfterDisconnect",
    value: async function onAfterDisconnect() {
      debug('Disconnected from lnd gRPC service');
    }
    /**
     * Connect to and activate the wallet unlocker api.
     */

  }, {
    key: "onBeforeActivateWalletUnlocker",
    value: async function onBeforeActivateWalletUnlocker() {
      if (this.services.WalletUnlocker.can('connect')) {
        await this.services.WalletUnlocker.connect();
      }
    }
    /**
     * Connect to and activate the main api.
     */

  }, {
    key: "onBeforeActivateLightning",
    value: async function onBeforeActivateLightning() {
      const _this$services = this.services,
            Lightning = _this$services.Lightning,
            WalletUnlocker = _this$services.WalletUnlocker; // await for RPC_ACTIVE state before interacting if needed

      if (this.isStateServiceAvailable) {
        await this.checkWalletState(['RPC_ACTIVE', 'SERVER_ACTIVE']);
      } // Disconnect wallet unlocker if its connected.


      if (WalletUnlocker.can('disconnect')) {
        await WalletUnlocker.disconnect();
      } // First connect to the Lightning service.


      await Lightning.connect(); // Fetch the determined version.

      const version = Lightning.version; // Get a list of all other available and supported services.

      const availableServices = _registry.default[version].services.map(s => s.name).filter(s => Object.keys(this.services).includes(s)).filter(s => !['WalletUnlocker', 'Lightning'].includes(s)); // Connect to the other services.


      await Promise.all(availableServices.filter(serviceName => this.services[serviceName].can('connect')).map(serviceName => {
        const service = this.services[serviceName];
        service.version = version; // Disable waiting for cert/macaroon for sub-services.

        return service.connect({
          waitForCert: false,
          waitForMacaroon: false
        });
      }));
    } // ------------------------------------
    // Helpers
    // ------------------------------------

    /**
     * Disconnect all services.
     */

  }, {
    key: "disconnectAll",
    value: async function disconnectAll() {
      debug('Disconnecting from all gRPC services');
      await Promise.all(Object.keys(this.services).map(serviceName => {
        const service = this.services[serviceName];

        if (service.can('disconnect')) {
          return service.disconnect();
        }
      }));
      debug('Disconnected from all gRPC services');
    }
    /**
     * Probe to determine what state lnd is in.
     */

  }, {
    key: "determineWalletState",
    value: async function determineWalletState(options = {
      keepalive: false
    }) {
      debug('Attempting to determine wallet state');
      let walletState;

      try {
        await this.services.WalletUnlocker.connect(); // Call the unlockWallet method with a missing password argument.
        // This is a way of probing the api to determine it's state.

        await this.services.WalletUnlocker.unlockWallet();
      } catch (error) {
        switch (error.code) {
          /*
            `UNIMPLEMENTED` indicates that the requested operation is not implemented or not supported/enabled in the
             service. This implies that the wallet is already unlocked, since the WalletUnlocker service is not active.
             See
              `DEADLINE_EXCEEDED` indicates that the deadline expired before the operation could complete. In the case of
             our probe here the likely cause of this is that we are connecting to an lnd node where the `noseedbackup`
             flag has been set and therefore the `WalletUnlocker` interace is non-functional.
              https://github.com/grpc/grpc-node/blob/master/packages/grpc-native-core/src/constants.js#L129.
           */
          case _grpcJs.status.UNIMPLEMENTED:
          case _grpcJs.status.DEADLINE_EXCEEDED:
            debug('Determined wallet state as:', _utils.WALLET_STATE_ACTIVE);
            walletState = _utils.WALLET_STATE_ACTIVE;
            return walletState;

          /**
            `UNKNOWN` indicates that unlockWallet was called without an argument which is invalid.
            This implies that the wallet is waiting to be unlocked.
          */

          case _grpcJs.status.UNKNOWN:
            debug('Determined wallet state as:', _utils.WALLET_STATE_LOCKED);
            walletState = _utils.WALLET_STATE_LOCKED;
            return walletState;

          /**
            Bubble all other errors back to the caller and abort the connection attempt.
            Disconnect all services.
          */

          default:
            debug('Unable to determine wallet state', error);
            throw error;
        }
      } finally {
        if (!options.keepalive && this.can('disconnect')) {
          await this.disconnect();
        }
      }
    }
    /**
     * Wait for wallet to enter a particular state.
     * @param  {string} state state to wait for (RPC_ACTIVE, LOCKED, UNLOCKED)
     * @return {Promise<Object>}.
     */

  }, {
    key: "checkWalletState",
    value: function checkWalletState(states) {
      states = [].concat(states);

      const waitForState = resolve => {
        return this.services.State.getState().then(currentState => {
          debug('Got wallet state as %o', currentState);

          if (states.includes(currentState.state)) {
            resolve(currentState.state);
          } else {
            setTimeout(_ => waitForState(resolve), 400);
          }
        });
      };

      return (0, _utils.promiseTimeout)(_utils.CONNECT_WAIT_TIMEOUT * 1000, new Promise(waitForState), 'Connection timeout out.');
    }
    /**
     * Wait for lnd to enter a particular state.
     * @param  {string} state Name of state to wait for (locked, active, disconnected)
     * @return {Promise<Object>} Object with `isDone` and `cancel` properties.
     */

  }, {
    key: "waitForState",
    value: function waitForState(stateName) {
      let successHandler;
      /**
       * Promise that resolves when service is active.
       */

      const isDone = new Promise(resolve => {
        // If the service is already in the requested state, return immediately.
        if (this.fsm.state === stateName) {
          return resolve();
        } // Otherwise, wait until we receive a relevant state change event.


        successHandler = () => resolve();

        this.prependOnceListener(stateName, successHandler);
      });
      /**
       * Method to abort the wait (prevent the isDone from resolving and remove activation event listener).
       */

      const cancel = () => {
        if (successHandler) {
          this.off(stateName, successHandler);
          successHandler = null;
        }
      };

      return {
        isDone,
        cancel
      };
    }
    /**
     * Get current wallet state
     * @return {Promise<Object>}.
     */

  }, {
    key: "getWalletState",
    value: async function getWalletState() {
      if (this.services.State.can('connect')) {
        await this.services.State.connect();
      }

      const currentState = await this.services.State.getState();
      debug('Got wallet state as %o', currentState);
      return currentState;
    }
  }]);

  return LndGrpc;
}(_events.default);

var _default = LndGrpc;
exports.default = _default;
module.exports = exports.default;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9ncnBjLmpzIl0sIm5hbWVzIjpbImRlYnVnIiwicHJvY2VzcyIsImVudiIsIkdSUENfU1NMX0NJUEhFUl9TVUlURVMiLCJncnBjU3NsQ2lwaGVyU3VpdGVzIiwiTG5kR3JwYyIsIm9wdGlvbnMiLCJsbmRjb25uZWN0VXJpIiwiY29ubmVjdGlvbkluZm8iLCJPYmplY3QiLCJhc3NpZ24iLCJmc20iLCJTdGF0ZU1hY2hpbmUiLCJpbml0IiwidHJhbnNpdGlvbnMiLCJuYW1lIiwiZnJvbSIsInRvIiwibWV0aG9kcyIsIm9uQmVmb3JlQWN0aXZhdGVXYWxsZXRVbmxvY2tlciIsImJpbmQiLCJvbkJlZm9yZUFjdGl2YXRlTGlnaHRuaW5nIiwib25CZWZvcmVEaXNjb25uZWN0Iiwib25BZnRlckRpc2Nvbm5lY3QiLCJvbkludmFsaWRUcmFuc2l0aW9uIiwib25QZW5kaW5nVHJhbnNpdGlvbiIsInRyYW5zaXRpb24iLCJFcnJvciIsInN1cHBvcnRlZFNlcnZpY2VzIiwiV2FsbGV0VW5sb2NrZXIiLCJMaWdodG5pbmciLCJBdXRvcGlsb3QiLCJDaGFpbk5vdGlmaWVyIiwiSW52b2ljZXMiLCJSb3V0ZXIiLCJTaWduZXIiLCJTdGF0ZSIsIlZlcnNpb25lciIsIldhbGxldEtpdCIsIldhdGNodG93ZXIiLCJXYXRjaHRvd2VyQ2xpZW50Iiwic2VydmljZXMiLCJ0b3IiLCJmb3JFYWNoIiwiU2VydmljZSIsImluc3RhbmNlIiwic2VydmljZU5hbWUiLCJhcmdzIiwiaXMiLCJjYW4iLCJvYnNlcnZlIiwic3RhdGUiLCJob3N0IiwiaXNTdGFydGVkIiwiZW1pdCIsInN0YXJ0Iiwid2FsbGV0U3RhdGUiLCJpc1N0YXRlU2VydmljZUF2YWlsYWJsZSIsImdldFdhbGxldFN0YXRlIiwiY2hlY2tXYWxsZXRTdGF0ZSIsIldBTExFVF9TVEFURV9MT0NLRUQiLCJXQUxMRVRfU1RBVEVfQUNUSVZFIiwiZXJyb3IiLCJjb2RlIiwic3RhdHVzIiwiVU5JTVBMRU1FTlRFRCIsImRldGVybWluZVdhbGxldFN0YXRlIiwiYWN0aXZhdGVXYWxsZXRVbmxvY2tlciIsImFjdGl2YXRlTGlnaHRuaW5nIiwiZSIsImRpc2Nvbm5lY3RBbGwiLCJkaXNjb25uZWN0Iiwic3RvcCIsImNvbm5lY3QiLCJ2ZXJzaW9uIiwiYXZhaWxhYmxlU2VydmljZXMiLCJyZWdpc3RyeSIsIm1hcCIsInMiLCJmaWx0ZXIiLCJrZXlzIiwiaW5jbHVkZXMiLCJQcm9taXNlIiwiYWxsIiwic2VydmljZSIsIndhaXRGb3JDZXJ0Iiwid2FpdEZvck1hY2Fyb29uIiwia2VlcGFsaXZlIiwidW5sb2NrV2FsbGV0IiwiREVBRExJTkVfRVhDRUVERUQiLCJVTktOT1dOIiwic3RhdGVzIiwiY29uY2F0Iiwid2FpdEZvclN0YXRlIiwicmVzb2x2ZSIsImdldFN0YXRlIiwidGhlbiIsImN1cnJlbnRTdGF0ZSIsInNldFRpbWVvdXQiLCJfIiwiQ09OTkVDVF9XQUlUX1RJTUVPVVQiLCJzdGF0ZU5hbWUiLCJzdWNjZXNzSGFuZGxlciIsImlzRG9uZSIsInByZXBlbmRPbmNlTGlzdGVuZXIiLCJjYW5jZWwiLCJvZmYiLCJFdmVudEVtaXR0ZXIiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7QUFBQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFZQTs7QUFjQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBRUEsTUFBTUEsS0FBSyxHQUFHLG9CQUFZLFlBQVosQ0FBZCxDLENBRUE7O0FBQ0EsSUFBSSxDQUFDQyxPQUFPLENBQUNDLEdBQVIsQ0FBWUMsc0JBQWpCLEVBQXlDO0FBQ3ZDRixFQUFBQSxPQUFPLENBQUNDLEdBQVIsQ0FBWUMsc0JBQVosR0FBcUNDLDBCQUFyQztBQUNEO0FBRUQ7QUFDQTtBQUNBO0FBQ0E7OztJQUNNQyxPOzs7OztBQUNKLG1CQUFZQyxPQUFPLEdBQUcsRUFBdEIsRUFBMEI7QUFBQTs7QUFBQTs7QUFDeEI7QUFDQU4sSUFBQUEsS0FBSyxDQUFFLHNDQUFGLEVBQXlDTSxPQUF6QyxDQUFMO0FBQ0Es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cUMsQ0FLdEM7OztBQUNBUSxRQUFBQSxjQUFjLEdBQUcsTUFBTVIsT0FBTyxFQUE5Qjs7QUFDQSxhQUFLVSxtQkFBTCxDQUF5QkgsU0FBekIsRUFBb0NDLGNBQXBDO0FBQ0QsT0FSYyxDQUFmO0FBVUE7QUFDSjtBQUNBOztBQUNJLFlBQU1HLE1BQU0sR0FBRyxNQUFNO0FBQ25CLFlBQUlILGNBQUosRUFBb0I7QUFDbEIsZUFBS0ksR0FBTCxDQUFTTCxTQUFULEVBQW9CQyxjQUFwQjtBQUNBQSxVQUFBQSxjQUFjLEdBQUcsSUFBakI7QUFDRDtBQUNGLE9BTEQ7O0FBT0EsYUFBTztBQUFFQyxRQUFBQSxNQUFGO0FBQVVFLFFBQUFBO0FBQVYsT0FBUDtBQUNEO0FBRUQ7QUFDRjtBQUNBO0FBQ0E7Ozs7V0FDRSxnQ0FBdUI7QUFDckIsVUFBSSxLQUFLaEUsUUFBTCxDQUFjTCxLQUFkLENBQW9CYSxHQUFwQixDQUF3QixTQUF4QixDQUFKLEVBQXdDO0FBQ3RDLGNBQU0sS0FBS1IsUUFBTCxDQUFjTCxLQUFkLENBQW9CcUMsT0FBcEIsRUFBTjtBQUNEOztBQUVELFlBQU13QixZQUFZLEdBQUcsTUFBTSxLQUFLeEQsUUFBTCxDQUFjTCxLQUFkLENBQW9CMkQsUUFBcEIsRUFBM0I7QUFDQS9GLE1BQUFBLEtBQUssQ0FBQyx3QkFBRCxFQUEyQmlHLFlBQTNCLENBQUw7QUFDQSxhQUFPQSxZQUFQO0FBQ0Q7Ozs7RUFuWG1CVSxlOztlQXNYUHRHLE8iLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgRXZlbnRFbWl0dGVyIGZyb20gJ2V2ZW50cydcbmltcG9ydCBTdGF0ZU1hY2hpbmUgZnJvbSAnamF2YXNjcmlwdC1zdGF0ZS1tYWNoaW5lJ1xuaW1wb3J0IGNyZWF0ZURlYnVnIGZyb20gJ2RlYnVnJ1xuaW1wb3J0IHBhcnNlIGZyb20gJ2xuZGNvbm5lY3QvcGFyc2UnXG5pbXBvcnQgeyBzdGF0dXMgfSBmcm9tICdAZ3JwYy9ncnBjLWpzJ1xuaW1wb3J0IHsgdG9yLCBpc1RvciB9IGZyb20gJy4vdXRpbHMnXG5pbXBvcnQge1xuICBnZXREZWFkbGluZSxcbiAgZ3JwY1NzbENpcGhlclN1aXRlcyxcbiAgdmFsaWRhdGVIb3N0LFxuICBvbkludmFsaWRUcmFuc2l0aW9uLFxuICBvblBlbmRpbmdUcmFuc2l0aW9uLFxuICBwcm9taXNlVGltZW91dCxcbiAgQ09OTkVDVF9XQUlUX1RJTUVPVVQsXG4gIFdBTExFVF9TVEFURV9MT0NLRUQsXG4gIFdBTExFVF9TVEFURV9BQ1RJVkUsXG59IGZyb20gJy4vdXRpbHMnXG5pbXBvcnQge1xuICBXYWxsZXRVbmxvY2tlcixcbiAgTGlnaHRuaW5nLFxuICBBdXRvcGlsb3QsXG4gIENoYWluTm90aWZpZXIsXG4gIEludm9pY2VzLFxuICBSb3V0ZXIsXG4gIFNpZ25lcixcbiAgU3RhdGUsXG4gIFZlcnNpb25lcixcbiAgV2FsbGV0S2l0LFxuICBXYXRjaHRvd2VyLFxuICBXYXRjaHRvd2VyQ2xpZW50XG59IGZyb20gJy4vc2VydmljZXMnXG5pbXBvcnQgcmVnaXN0cnkgZnJvbSAnLi9yZWdpc3RyeSdcblxuY29uc3QgZGVidWcgPSBjcmVhdGVEZWJ1ZygnbG5ycGM6Z3JwYycpXG5cbi8vIFNldCB1cCBTU0wgd2l0aCB0aGUgY3lwaGVyIHN1aXRzIHRoYXQgd2UgbmVlZC5cbmlmICghcHJvY2Vzcy5lbnYuR1JQQ19TU0xfQ0lQSEVSX1NVSVRFUykge1xuICBwcm9jZXNzLmVudi5HUlBDX1NTTF9DSVBIRVJfU1VJVEVTID0gZ3JwY1NzbENpcGhlclN1aXRlc1xufVxuXG4vKipcbiAqIExuZCBnUlBDIHNlcnZpY2Ugd3JhcHBlci5cbiAqIEBleHRlbmRzIEV2ZW50RW1pdHRlclxuICovXG5jbGFzcyBMbmRHcnBjIGV4dGVuZHMgRXZlbnRFbWl0dGVyIHtcbiAgY29uc3RydWN0b3Iob3B0aW9ucyA9IHt9KSB7XG4gICAgc3VwZXIoKVxuICAgIGRlYnVnKGBJbml0aWFsaXppbmcgTG5kR3JwYyB3aXRoIGNvbmZpZzogJW9gLCBvcHRpb25zKVxuICAgIHRoaXMub3B0aW9ucyA9IG9wdGlvbnNcblxuICAgIC8vIElmIGFuIGxuZGNvbm5lY3QgdXJpIHdhcyBwcm92aWRlZCwgZXh0cmFjdCB0aGUgY29ubmVjdGlvbiBkZXRhaWxzIGZyb20gdGhhdC5cbiAgICBpZiAob3B0aW9ucy5sbmRjb25uZWN0VXJpKSB7XG4gICAgICBjb25zdCBjb25uZWN0aW9uSW5mbyA9IHBhcnNlKG9wdGlvbnMubG5kY29ubmVjdFVyaSlcbiAgICAgIE9iamVjdC5hc3NpZ24odGhpcy5vcHRpb25zLCBjb25uZWN0aW9uSW5mbylcbiAgICB9XG5cbiAgICAvLyBEZWZpbmUgc3RhdGUgbWFjaGluZS5cbiAgICB0aGlzLmZzbSA9IG5ldyBTdGF0ZU1hY2hpbmUoe1xuICAgICAgaW5pdDogJ3JlYWR5JyxcbiAgICAgIHRyYW5zaXRpb25zOiBbXG4gICAgICAgIHsgbmFtZTogJ2FjdGl2YXRlV2FsbGV0VW5sb2NrZXInLCBmcm9tOiBbJ3JlYWR5JywgJ2FjdGl2ZSddLCB0bzogJ2xvY2tlZCcgfSxcbiAgICAgICAgeyBuYW1lOiAnYWN0aXZhdGVMaWdodG5pbmcnLCBmcm9tOiBbJ3JlYWR5JywgJ2xvY2tlZCddLCB0bzogJ2FjdGl2ZScgfSxcbiAgICAgICAgeyBuYW1lOiAnZGlzY29ubmVjdCcsIGZyb206IFsnbG9ja2VkJywgJ2FjdGl2ZSddLCB0bzogJ3JlYWR5JyB9LFxuICAgICAgXSxcbiAgICAgIG1ldGhvZHM6IHtcbiAgICAgICAgb25CZWZvcmVBY3RpdmF0ZVdhbGxldFVubG9ja2VyOiB0aGlzLm9uQmVmb3JlQWN0aXZhdGVXYWxsZXRVbmxvY2tlci5iaW5kKHRoaXMpLFxuICAgICAgICBvbkJlZm9yZUFjdGl2YXRlTGlnaHRuaW5nOiB0aGlzLm9uQmVmb3JlQWN0aXZhdGVMaWdodG5pbmcuYmluZCh0aGlzKSxcbiAgICAgICAgb25CZWZvcmVEaXNjb25uZWN0OiB0aGlzLm9uQmVmb3JlRGlzY29ubmVjdC5iaW5kKHRoaXMpLFxuICAgICAgICBvbkFmdGVyRGlzY29ubmVjdDogdGhpcy5vbkFmdGVyRGlzY29ubmVjdC5iaW5kKHRoaXMpLFxuICAgICAgICBvbkludmFsaWRUcmFuc2l0aW9uLFxuICAgICAgICBvblBlbmRpbmdUcmFuc2l0aW9uLFxuICAgICAgfSxcblxuICAgICAgb25JbnZhbGlkVHJhbnNpdGlvbih0cmFuc2l0aW9uLCBmcm9tLCB0bykge1xuICAgICAgICB0aHJvdyBPYmplY3QuYXNzaWduKG5ldyBFcnJvcihgdHJhbnNpdGlvbiBpcyBpbnZhbGlkIGluIGN1cnJlbnQgc3RhdGVgKSwgeyB0cmFuc2l0aW9uLCBmcm9tLCB0byB9KVxuICAgICAgfSxcbiAgICB9KVxuXG4gICAgLy8gRGVmaW5lIHNlcnZpY2VzLlxuICAgIHRoaXMuc3VwcG9ydGVkU2VydmljZXMgPSBbXG4gICAgICBXYWxsZXRVbmxvY2tlcixcbiAgICAgIExpZ2h0bmluZyxcbiAgICAgIEF1dG9waWxvdCxcbiAgICAgIENoYWluTm90aWZpZXIsXG4gICAgICBJbnZvaWNlcyxcbiAgICAgIFJvdXRlcixcbiAgICAgIFNpZ25lcixcbiAgICAgIFN0YXRlLFxuICAgICAgVmVyc2lvbmVyLFxuICAgICAgV2FsbGV0S2l0LFxuICAgICAgV2F0Y2h0b3dlcixcbiAgICAgIFdhdGNodG93ZXJDbGllbnRcbiAgICBdXG5cbiAgICB0aGlzLnNlcnZpY2VzID0ge31cbiAgICB0aGlzLnRvciA9IHRvcigpXG5cbiAgICAvLyBJbnN0YW50aWF0ZSBzZXJ2aWNlcy5cbiAgICB0aGlzLnN1cHBvcnRlZFNlcnZpY2VzLmZvckVhY2goKFNlcnZpY2UpID0+IHtcbiAgICAgIGNvbnN0IGluc3RhbmNlID0gbmV3IFNlcnZpY2UodGhpcy5vcHRpb25zKVxuICAgICAgdGhpcy5zZXJ2aWNlc1tpbnN0YW5jZS5zZXJ2aWNlTmFtZV0gPSBpbnN0YW5jZVxuICAgIH0pXG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgLy8gRlNNIFByb3hpZXNcbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgaXMoLi4uYXJncykge1xuICAgIHJldHVybiB0aGlzLmZzbS5pcyguLi5hcmdzKVxuICB9XG4gIGNhbiguLi5hcmdzKSB7XG4gICAgcmV0dXJuIHRoaXMuZnNtLmNhbiguLi5hcmdzKVxuICB9XG4gIG9ic2VydmUoLi4uYXJncykge1xuICAgIHJldHVybiB0aGlzLmZzbS5vYnNlcnZlKC4uLmFyZ3MpXG4gIH1cbiAgZ2V0IHN0YXRlKCkge1xuICAgIHJldHVybiB0aGlzLmZzbS5zdGF0ZVxuICB9XG5cbiAgYXN5bmMgY29ubmVjdCgpIHtcbiAgICBkZWJ1ZyhgQ29ubmVjdGluZyB0byBsbmQgZ1JQQyBzZXJ2aWNlYClcblxuICAgIC8vIFZlcmlmeSB0aGF0IHRoZSBob3N0IGlzIHZhbGlkLlxuICAgIGNvbnN0IHsgaG9zdCB9ID0gdGhpcy5vcHRpb25zXG4gICAgYXdhaXQgdmFsaWRhdGVIb3N0KGhvc3QpXG5cbiAgICAvLyBTdGFydCB0b3Igc2VydmljZSBpZiBuZWVkZWQuXG4gICAgaWYgKGlzVG9yKGhvc3QpICYmICF0aGlzLnRvci5pc1N0YXJ0ZWQoKSkge1xuICAgICAgdGhpcy5lbWl0KCd0b3Iuc3RhcnRpbmcnKVxuICAgICAgYXdhaXQgdGhpcy50b3Iuc3RhcnQoKVxuICAgICAgdGhpcy5lbWl0KCd0b3Iuc3RhcnRlZCcpXG4gICAgfVxuXG4gICAgLy8gRm9yIGxuZCA+PSAwLjEzLiosIHRoZSBzdGF0ZSBzZXJ2aWNlIGlzIGF2YWlsYWJsZSB3aGljaCBwcm92aWRlcyB3aXRoXG4gICAgLy8gdGhlIHdhbGxldCBzdGF0ZS4gRm9yIGxvd2VyIHZlcnNpb24gb2YgbG5kIGNvbnRpbnVlIHRvIHVzZSBXYWxsZXRVbmxvY2tlclxuICAgIC8vIGVycm9yIGNvZGVzXG4gICAgbGV0IHdhbGxldFN0YXRlXG4gICAgdGhpcy5pc1N0YXRlU2VydmljZUF2YWlsYWJsZSA9IGZhbHNlXG5cbiAgICB0cnkge1xuICAgICAgLy8gU3Vic2NyaWJlIHRvIHdhbGxldCBzdGF0ZSBhbmQgZ2V0IGN1cnJlbnQgc3RhdGVcbiAgICAgIGxldCB7IHN0YXRlIH0gPSBhd2FpdCB0aGlzLmdldFdhbGxldFN0YXRlKClcbiAgICAgIGlmIChzdGF0ZSA9PSAnV0FJVElOR19UT19TVEFSVCcpIHtcbiAgICAgICAgc3RhdGUgPSBhd2FpdCB0aGlzLmNoZWNrV2FsbGV0U3RhdGUoWydOT05fRVhJU1RJTkcnLCAnTE9DS0VEJ10pO1xuICAgICAgfVxuXG4gICAgICBzd2l0Y2ggKHN0YXRlKSB7XG4gICAgICAgIGNhc2UgJ05PTl9FWElTVElORyc6XG4gICAgICAgIGNhc2UgJ0xPQ0tFRCc6XG4gICAgICAgICAgd2FsbGV0U3RhdGUgPSBXQUxMRVRfU1RBVEVfTE9DS0VEXG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgY2FzZSAnVU5MT0NLRUQnOiAvLyBEbyBub3RoaW5nLlxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIGNhc2UgJ1JQQ19BQ1RJVkUnOlxuICAgICAgICAgIHdhbGxldFN0YXRlID0gV0FMTEVUX1NUQVRFX0FDVElWRVxuICAgICAgICAgIGJyZWFrXG4gICAgICB9XG4gICAgICB0aGlzLmlzU3RhdGVTZXJ2aWNlQXZhaWxhYmxlID0gdHJ1ZVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoZXJyb3IuY29kZSA9PT0gc3RhdHVzLlVOSU1QTEVNRU5URUQpIHtcbiAgICAgICAgLy8gUHJvYmUgdGhlIHNlcnZpY2VzIHRvIGRldGVybWluZSB0aGUgd2FsbGV0IHN0YXRlLlxuICAgICAgICB3YWxsZXRTdGF0ZSA9IGF3YWl0IHRoaXMuZGV0ZXJtaW5lV2FsbGV0U3RhdGUoKVxuICAgICAgfVxuICAgIH1cbiAgICBzd2l0Y2ggKHdhbGxldFN0YXRlKSB7XG4gICAgICBjYXNlIFdBTExFVF9TVEFURV9MT0NLRUQ6XG4gICAgICAgIGF3YWl0IHRoaXMuYWN0aXZhdGVXYWxsZXRVbmxvY2tlcigpXG4gICAgICAgIGJyZWFrXG5cbiAgICAgIGNhc2UgV0FMTEVUX1NUQVRFX0FDVElWRTpcbiAgICAgICAgYXdhaXQgdGhpcy5hY3RpdmF0ZUxpZ2h0bmluZygpXG4gICAgICAgIGJyZWFrXG4gICAgfVxuICB9XG5cbiAgYXN5bmMgYWN0aXZhdGVXYWxsZXRVbmxvY2tlciguLi5hcmdzKSB7XG4gICAgYXdhaXQgdGhpcy5mc20uYWN0aXZhdGVXYWxsZXRVbmxvY2tlciguLi5hcmdzKVxuICAgIHRoaXMuZW1pdCgnbG9ja2VkJylcbiAgfVxuXG4gIGFzeW5jIGFjdGl2YXRlTGlnaHRuaW5nKC4uLmFyZ3MpIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5mc20uYWN0aXZhdGVMaWdodG5pbmcoLi4uYXJncylcbiAgICAgIHRoaXMuZW1pdCgnYWN0aXZlJylcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBhd2FpdCB0aGlzLmRpc2Nvbm5lY3RBbGwoKVxuICAgICAgdGhyb3cgZVxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGRpc2Nvbm5lY3QoLi4uYXJncykge1xuICAgIGlmICh0aGlzLmNhbignZGlzY29ubmVjdCcpKSB7XG4gICAgICBhd2FpdCB0aGlzLmZzbS5kaXNjb25uZWN0KC4uLmFyZ3MpXG4gICAgfVxuICAgIGlmICh0aGlzLnRvci5pc1N0YXJ0ZWQoKSkge1xuICAgICAgdGhpcy5lbWl0KCd0b3Iuc3RvcHBpbmcnKVxuICAgICAgYXdhaXQgdGhpcy50b3Iuc3RvcCgpXG4gICAgICB0aGlzLmVtaXQoJ3Rvci5zdG9wcGVkJylcbiAgICB9XG4gICAgdGhpcy5lbWl0KCdkaXNjb25uZWN0ZWQnKVxuICB9XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gIC8vIEZTTSBPYnNlcnZlcnNcbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgLyoqXG4gICAqIERpc2Nvbm5lY3QgZnJvbSB0aGUgZ1JQQyBzZXJ2aWNlLlxuICAgKi9cbiAgYXN5bmMgb25CZWZvcmVEaXNjb25uZWN0KCkge1xuICAgIGRlYnVnKGBEaXNjb25uZWN0aW5nIGZyb20gbG5kIGdSUEMgc2VydmljZWApXG4gICAgYXdhaXQgdGhpcy5kaXNjb25uZWN0QWxsKClcbiAgfVxuICAvKipcbiAgICogTG9nIHN1Y2Nlc3NmdWwgZGlzY29ubmVjdC5cbiAgICovXG4gIGFzeW5jIG9uQWZ0ZXJEaXNjb25uZWN0KCkge1xuICAgIGRlYnVnKCdEaXNjb25uZWN0ZWQgZnJvbSBsbmQgZ1JQQyBzZXJ2aWNlJylcbiAgfVxuXG4gIC8qKlxuICAgKiBDb25uZWN0IHRvIGFuZCBhY3RpdmF0ZSB0aGUgd2FsbGV0IHVubG9ja2VyIGFwaS5cbiAgICovXG4gIGFzeW5jIG9uQmVmb3JlQWN0aXZhdGVXYWxsZXRVbmxvY2tlcigpIHtcbiAgICBpZiAodGhpcy5zZXJ2aWNlcy5XYWxsZXRVbmxvY2tlci5jYW4oJ2Nvbm5lY3QnKSkge1xuICAgICAgYXdhaXQgdGhpcy5zZXJ2aWNlcy5XYWxsZXRVbmxvY2tlci5jb25uZWN0KClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ29ubmVjdCB0byBhbmQgYWN0aXZhdGUgdGhlIG1haW4gYXBpLlxuICAgKi9cbiAgYXN5bmMgb25CZWZvcmVBY3RpdmF0ZUxpZ2h0bmluZygpIHtcbiAgICBjb25zdCB7IExpZ2h0bmluZywgV2FsbGV0VW5sb2NrZXIgfSA9IHRoaXMuc2VydmljZXNcblxuICAgIC8vIGF3YWl0IGZvciBSUENfQUNUSVZFIHN0YXRlIGJlZm9yZSBpbnRlcmFjdGluZyBpZiBuZWVkZWRcbiAgICBpZiAodGhpcy5pc1N0YXRlU2VydmljZUF2YWlsYWJsZSkge1xuICAgICAgYXdhaXQgdGhpcy5jaGVja1dhbGxldFN0YXRlKCdSUENfQUNUSVZFJylcbiAgICB9XG5cbiAgICAvLyBEaXNjb25uZWN0IHdhbGxldCB1bmxvY2tlciBpZiBpdHMgY29ubmVjdGVkLlxuICAgIGlmIChXYWxsZXRVbmxvY2tlci5jYW4oJ2Rpc2Nvbm5lY3QnKSkge1xuICAgICAgYXdhaXQgV2FsbGV0VW5sb2NrZXIuZGlzY29ubmVjdCgpXG4gICAgfVxuICAgIC8vIEZpcnN0IGNvbm5lY3QgdG8gdGhlIExpZ2h0bmluZyBzZXJ2aWNlLlxuICAgIGF3YWl0IExpZ2h0bmluZy5jb25uZWN0KClcblxuICAgIC8vIEZldGNoIHRoZSBkZXRlcm1pbmVkIHZlcnNpb24uXG4gICAgY29uc3QgeyB2ZXJzaW9uIH0gPSBMaWdodG5pbmdcblxuICAgIC8vIEdldCBhIGxpc3Qgb2YgYWxsIG90aGVyIGF2YWlsYWJsZSBhbmQgc3VwcG9ydGVkIHNlcnZpY2VzLlxuICAgIGNvbnN0IGF2YWlsYWJsZVNlcnZpY2VzID0gcmVnaXN0cnlbdmVyc2lvbl0uc2VydmljZXNcbiAgICAgIC5tYXAoKHMpID0+IHMubmFtZSlcbiAgICAgIC5maWx0ZXIoKHMpID0+IE9iamVjdC5rZXlzKHRoaXMuc2VydmljZXMpLmluY2x1ZGVzKHMpKVxuICAgICAgLmZpbHRlcigocykgPT4gIVsnV2FsbGV0VW5sb2NrZXInLCAnTGlnaHRuaW5nJ10uaW5jbHVkZXMocykpXG5cbiAgICAvLyBDb25uZWN0IHRvIHRoZSBvdGhlciBzZXJ2aWNlcy5cbiAgICBhd2FpdCBQcm9taXNlLmFsbChcbiAgICAgIGF2YWlsYWJsZVNlcnZpY2VzXG4gICAgICAgIC5maWx0ZXIoKHNlcnZpY2VOYW1lKSA9PiB0aGlzLnNlcnZpY2VzW3NlcnZpY2VOYW1lXS5jYW4oJ2Nvbm5lY3QnKSlcbiAgICAgICAgLm1hcCgoc2VydmljZU5hbWUpID0+IHtcbiAgICAgICAgICBjb25zdCBzZXJ2aWNlID0gdGhpcy5zZXJ2aWNlc1tzZXJ2aWNlTmFtZV1cbiAgICAgICAgICBzZXJ2aWNlLnZlcnNpb24gPSB2ZXJzaW9uXG4gICAgICAgICAgLy8gRGlzYWJsZSB3YWl0aW5nIGZvciBjZXJ0L21hY2Fyb29uIGZvciBzdWItc2VydmljZXMuXG4gICAgICAgICAgcmV0dXJuIHNlcnZpY2UuY29ubmVjdCh7XG4gICAgICAgICAgICB3YWl0Rm9yQ2VydDogZmFsc2UsXG4gICAgICAgICAgICB3YWl0Rm9yTWFjYXJvb246IGZhbHNlLFxuICAgICAgICAgIH0pXG4gICAgICAgIH0pLFxuICAgIClcbiAgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAvLyBIZWxwZXJzXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIC8qKlxuICAgKiBEaXNjb25uZWN0IGFsbCBzZXJ2aWNlcy5cbiAgICovXG4gIGFzeW5jIGRpc2Nvbm5lY3RBbGwoKSB7XG4gICAgZGVidWcoJ0Rpc2Nvbm5lY3RpbmcgZnJvbSBhbGwgZ1JQQyBzZXJ2aWNlcycpXG4gICAgYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICBPYmplY3Qua2V5cyh0aGlzLnNlcnZpY2VzKS5tYXAoKHNlcnZpY2VOYW1lKSA9PiB7XG4gICAgICAgIGNvbnN0IHNlcnZpY2UgPSB0aGlzLnNlcnZpY2VzW3NlcnZpY2VOYW1lXVxuICAgICAgICBpZiAoc2VydmljZS5jYW4oJ2Rpc2Nvbm5lY3QnKSkge1xuICAgICAgICAgIHJldHVybiBzZXJ2aWNlLmRpc2Nvbm5lY3QoKVxuICAgICAgICB9XG4gICAgICB9KSxcbiAgICApXG4gICAgZGVidWcoJ0Rpc2Nvbm5lY3RlZCBmcm9tIGFsbCBnUlBDIHNlcnZpY2VzJylcbiAgfVxuXG4gIC8qKlxuICAgKiBQcm9iZSB0byBkZXRlcm1pbmUgd2hhdCBzdGF0ZSBsbmQgaXMgaW4uXG4gICAqL1xuICBhc3luYyBkZXRlcm1pbmVXYWxsZXRTdGF0ZShvcHRpb25zID0geyBrZWVwYWxpdmU6IGZhbHNlIH0pIHtcbiAgICBkZWJ1ZygnQXR0ZW1wdGluZyB0byBkZXRlcm1pbmUgd2FsbGV0IHN0YXRlJylcbiAgICBsZXQgd2FsbGV0U3RhdGVcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5zZXJ2aWNlcy5XYWxsZXRVbmxvY2tlci5jb25uZWN0KClcbiAgICAgIC8vIENhbGwgdGhlIHVubG9ja1dhbGxldCBtZXRob2Qgd2l0aCBhIG1pc3NpbmcgcGFzc3dvcmQgYXJndW1lbnQuXG4gICAgICAvLyBUaGlzIGlzIGEgd2F5IG9mIHByb2JpbmcgdGhlIGFwaSB0byBkZXRlcm1pbmUgaXQncyBzdGF0ZS5cbiAgICAgIGF3YWl0IHRoaXMuc2VydmljZXMuV2FsbGV0VW5sb2NrZXIudW5sb2NrV2FsbGV0KClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgc3dpdGNoIChlcnJvci5jb2RlKSB7XG4gICAgICAgIC8qXG4gICAgICAgICAgYFVOSU1QTEVNRU5URURgIGluZGljYXRlcyB0aGF0IHRoZSByZXF1ZXN0ZWQgb3BlcmF0aW9uIGlzIG5vdCBpbXBsZW1lbnRlZCBvciBub3Qgc3VwcG9ydGVkL2VuYWJsZWQgaW4gdGhlXG4gICAgICAgICAgIHNlcnZpY2UuIFRoaXMgaW1wbGllcyB0aGF0IHRoZSB3YWxsZXQgaXMgYWxyZWFkeSB1bmxvY2tlZCwgc2luY2UgdGhlIFdhbGxldFVubG9ja2VyIHNlcnZpY2UgaXMgbm90IGFjdGl2ZS5cbiAgICAgICAgICAgU2VlXG5cbiAgICAgICAgICAgYERFQURMSU5FX0VYQ0VFREVEYCBpbmRpY2F0ZXMgdGhhdCB0aGUgZGVhZGxpbmUgZXhwaXJlZCBiZWZvcmUgdGhlIG9wZXJhdGlvbiBjb3VsZCBjb21wbGV0ZS4gSW4gdGhlIGNhc2Ugb2ZcbiAgICAgICAgICAgb3VyIHByb2JlIGhlcmUgdGhlIGxpa2VseSBjYXVzZSBvZiB0aGlzIGlzIHRoYXQgd2UgYXJlIGNvbm5lY3RpbmcgdG8gYW4gbG5kIG5vZGUgd2hlcmUgdGhlIGBub3NlZWRiYWNrdXBgXG4gICAgICAgICAgIGZsYWcgaGFzIGJlZW4gc2V0IGFuZCB0aGVyZWZvcmUgdGhlIGBXYWxsZXRVbmxvY2tlcmAgaW50ZXJhY2UgaXMgbm9uLWZ1bmN0aW9uYWwuXG5cbiAgICAgICAgICAgaHR0cHM6Ly9naXRodWIuY29tL2dycGMvZ3JwYy1ub2RlL2Jsb2IvbWFzdGVyL3BhY2thZ2VzL2dycGMtbmF0aXZlLWNvcmUvc3JjL2NvbnN0YW50cy5qcyNMMTI5LlxuICAgICAgICAgKi9cbiAgICAgICAgY2FzZSBzdGF0dXMuVU5JTVBMRU1FTlRFRDpcbiAgICAgICAgY2FzZSBzdGF0dXMuREVBRExJTkVfRVhDRUVERUQ6XG4gICAgICAgICAgZGVidWcoJ0RldGVybWluZWQgd2FsbGV0IHN0YXRlIGFzOicsIFdBTExFVF9TVEFURV9BQ1RJVkUpXG4gICAgICAgICAgd2FsbGV0U3RhdGUgPSBXQUxMRVRfU1RBVEVfQUNUSVZFXG4gICAgICAgICAgcmV0dXJuIHdhbGxldFN0YXRlXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAgYFVOS05PV05gIGluZGljYXRlcyB0aGF0IHVubG9ja1dhbGxldCB3YXMgY2FsbGVkIHdpdGhvdXQgYW4gYXJndW1lbnQgd2hpY2ggaXMgaW52YWxpZC5cbiAgICAgICAgICBUaGlzIGltcGxpZXMgdGhhdCB0aGUgd2FsbGV0IGlzIHdhaXRpbmcgdG8gYmUgdW5sb2NrZWQuXG4gICAgICAgICovXG4gICAgICAgIGNhc2Ugc3RhdHVzLlVOS05PV046XG4gICAgICAgICAgZGVidWcoJ0RldGVybWluZWQgd2FsbGV0IHN0YXRlIGFzOicsIFdBTExFVF9TVEFURV9MT0NLRUQpXG4gICAgICAgICAgd2FsbGV0U3RhdGUgPSBXQUxMRVRfU1RBVEVfTE9DS0VEXG4gICAgICAgICAgcmV0dXJuIHdhbGxldFN0YXRlXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAgQnViYmxlIGFsbCBvdGhlciBlcnJvcnMgYmFjayB0byB0aGUgY2FsbGVyIGFuZCBhYm9ydCB0aGUgY29ubmVjdGlvbiBhdHRlbXB0LlxuICAgICAgICAgIERpc2Nvbm5lY3QgYWxsIHNlcnZpY2VzLlxuICAgICAgICAqL1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIGRlYnVnKCdVbmFibGUgdG8gZGV0ZXJtaW5lIHdhbGxldCBzdGF0ZScsIGVycm9yKVxuICAgICAgICAgIHRocm93IGVycm9yXG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmICghb3B0aW9ucy5rZWVwYWxpdmUgJiYgdGhpcy5jYW4oJ2Rpc2Nvbm5lY3QnKSkge1xuICAgICAgICBhd2FpdCB0aGlzLmRpc2Nvbm5lY3QoKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBXYWl0IGZvciB3YWxsZXQgdG8gZW50ZXIgYSBwYXJ0aWN1bGFyIHN0YXRlLlxuICAgKiBAcGFyYW0gIHtzdHJpbmd9IHN0YXRlIHN0YXRlIHRvIHdhaXQgZm9yIChSUENfQUNUSVZFLCBMT0NLRUQsIFVOTE9DS0VEKVxuICAgKiBAcmV0dXJuIHtQcm9taXNlPE9iamVjdD59LlxuICAgKi9cbiAgY2hlY2tXYWxsZXRTdGF0ZShzdGF0ZXMpIHtcbiAgICBzdGF0ZXMgPSBbXS5jb25jYXQoc3RhdGVzKVxuICAgIGNvbnN0IHdhaXRGb3JTdGF0ZSA9IHJlc29sdmUgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuc2VydmljZXMuU3RhdGUuZ2V0U3RhdGUoKVxuICAgICAgICAudGhlbihjdXJyZW50U3RhdGUgPT4ge1xuICAgICAgICAgIGRlYnVnKCdHb3Qgd2FsbGV0IHN0YXRlIGFzICVvJywgY3VycmVudFN0YXRlKVxuICAgICAgICAgIGlmIChzdGF0ZXMuaW5jbHVkZXMoY3VycmVudFN0YXRlLnN0YXRlKSkge1xuICAgICAgICAgICAgcmVzb2x2ZShjdXJyZW50U3RhdGUuc3RhdGUpXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHNldFRpbWVvdXQoXyA9PiB3YWl0Rm9yU3RhdGUocmVzb2x2ZSksIDQwMCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIH1cbiAgICByZXR1cm4gcHJvbWlzZVRpbWVvdXQoQ09OTkVDVF9XQUlUX1RJTUVPVVQgKiAxMDAwLCBuZXcgUHJvbWlzZSh3YWl0Rm9yU3RhdGUpLCAnQ29ubmVjdGlvbiB0aW1lb3V0IG91dC4nKVxuICB9XG5cbiAgLyoqXG4gICAqIFdhaXQgZm9yIGxuZCB0byBlbnRlciBhIHBhcnRpY3VsYXIgc3RhdGUuXG4gICAqIEBwYXJhbSAge3N0cmluZ30gc3RhdGUgTmFtZSBvZiBzdGF0ZSB0byB3YWl0IGZvciAobG9ja2VkLCBhY3RpdmUsIGRpc2Nvbm5lY3RlZClcbiAgICogQHJldHVybiB7UHJvbWlzZTxPYmplY3Q+fSBPYmplY3Qgd2l0aCBgaXNEb25lYCBhbmQgYGNhbmNlbGAgcHJvcGVydGllcy5cbiAgICovXG4gIHdhaXRGb3JTdGF0ZShzdGF0ZU5hbWUpIHtcbiAgICBsZXQgc3VjY2Vzc0hhbmRsZXJcblxuICAgIC8qKlxuICAgICAqIFByb21pc2UgdGhhdCByZXNvbHZlcyB3aGVuIHNlcnZpY2UgaXMgYWN0aXZlLlxuICAgICAqL1xuICAgIGNvbnN0IGlzRG9uZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICAvLyBJZiB0aGUgc2VydmljZSBpcyBhbHJlYWR5IGluIHRoZSByZXF1ZXN0ZWQgc3RhdGUsIHJldHVybiBpbW1lZGlhdGVseS5cbiAgICAgIGlmICh0aGlzLmZzbS5zdGF0ZSA9PT0gc3RhdGVOYW1lKSB7XG4gICAgICAgIHJldHVybiByZXNvbHZlKClcbiAgICAgIH1cbiAgICAgIC8vIE90aGVyd2lzZSwgd2FpdCB1bnRpbCB3ZSByZWNlaXZlIGEgcmVsZXZhbnQgc3RhdGUgY2hhbmdlIGV2ZW50LlxuICAgICAgc3VjY2Vzc0hhbmRsZXIgPSAoKSA9PiByZXNvbHZlKClcbiAgICAgIHRoaXMucHJlcGVuZE9uY2VMaXN0ZW5lcihzdGF0ZU5hbWUsIHN1Y2Nlc3NIYW5kbGVyKVxuICAgIH0pXG5cbiAgICAvKipcbiAgICAgKiBNZXRob2QgdG8gYWJvcnQgdGhlIHdhaXQgKHByZXZlbnQgdGhlIGlzRG9uZSBmcm9tIHJlc29sdmluZyBhbmQgcmVtb3ZlIGFjdGl2YXRpb24gZXZlbnQgbGlzdGVuZXIpLlxuICAgICAqL1xuICAgIGNvbnN0IGNhbmNlbCA9ICgpID0+IHtcbiAgICAgIGlmIChzdWNjZXNzSGFuZGxlcikge1xuICAgICAgICB0aGlzLm9mZihzdGF0ZU5hbWUsIHN1Y2Nlc3NIYW5kbGVyKVxuICAgICAgICBzdWNjZXNzSGFuZGxlciA9IG51bGxcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4geyBpc0RvbmUsIGNhbmNlbCB9XG4gIH1cblxuICAvKipcbiAgICogR2V0IGN1cnJlbnQgd2FsbGV0IHN0YXRlXG4gICAqIEByZXR1cm4ge1Byb21pc2U8T2JqZWN0Pn0uXG4gICAqL1xuICBhc3luYyBnZXRXYWxsZXRTdGF0ZSgpIHtcbiAgICBpZiAodGhpcy5zZXJ2aWNlcy5TdGF0ZS5jYW4oJ2Nvbm5lY3QnKSkge1xuICAgICAgYXdhaXQgdGhpcy5zZXJ2aWNlcy5TdGF0ZS5jb25uZWN0KClcbiAgICB9XG5cbiAgICBjb25zdCBjdXJyZW50U3RhdGUgPSBhd2FpdCB0aGlzLnNlcnZpY2VzLlN0YXRlLmdldFN0YXRlKClcbiAgICBkZWJ1ZygnR290IHdhbGxldCBzdGF0ZSBhcyAlbycsIGN1cnJlbnRTdGF0ZSlcbiAgICByZXR1cm4gY3VycmVudFN0YXRlXG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgTG5kR3JwY1xuIl19