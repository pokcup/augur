var constants = require('../libs/constants');
var utilities = require('../libs/utilities');

var NetworkActions = {

  /**
   * Update the UI and stores depending on the state of the network.
   *
   * If the daemon just became reachable (including startup), load the
   * latest data and ensure that we're monitoring new blocks to update our
   * stores. If our Ethereum daemon just became unreachable, dispatch an event so
   * an error dialog can be display.
   */
  checkNetwork: function() {

    var ethereumClient = this.flux.store('config').getEthereumClient();
    var networkState = this.flux.store('network').getState()

    var nowUp = ethereumClient.isAvailable();
    var wasUp = (
      !networkState.ethereumStatus ||
      networkState.ethereumStatus === constants.network.ETHEREUM_STATUS_CONNECTED
    );
    var wasDown = (
      !networkState.ethereumStatus ||
      networkState.ethereumStatus === constants.network.ETHEREUM_STATUS_FAILED
    );

    if (wasUp && !nowUp) {

      utilities.warn('failed to connect to ethereum');

      this.dispatch(
        constants.network.UPDATE_ETHEREUM_STATUS,
        {ethereumStatus: constants.network.ETHEREUM_STATUS_FAILED}
      );

    } else if (wasDown && nowUp) {

      this.dispatch(
        constants.network.UPDATE_ETHEREUM_STATUS,
        {
          ethereumStatus: constants.network.ETHEREUM_STATUS_CONNECTED
        }
      );

      this.flux.actions.network.loadEverything();
      this.flux.actions.network.startMonitoring();
    }

    // check yo self
    setTimeout(this.flux.actions.network.checkNetwork, 3000);
  },

  loadNetwork: function () {

    var ethereumClient = this.flux.store('config').getEthereumClient();
    var networkStats = ethereumClient.getStats();

    this.dispatch(constants.network.LOAD_NETWORK, {
      accounts: ethereumClient.getAccounts(),
      primaryAccount: ethereumClient.getPrimaryAccount(),
      peerCount: networkStats.peerCount,
      blockNumber: networkStats.blockNumber,
      gasPrice: networkStats.gasPrice,
      mining: networkStats.mining,
      hashrate: networkStats.hashrate
    });
  },

  /**
   * Load all of the application's data, particularly during initialization.
   */
  loadEverything: function () {
    this.flux.actions.network.loadNetwork();
    this.flux.actions.asset.loadAssets();
    this.flux.actions.branch.loadBranches();
    this.flux.actions.branch.loadCurrentBranch();
    this.flux.actions.market.loadMarkets();
    this.flux.actions.branch.loadEventsToReport();
  },

  /**
   * Update data that should change over time in the UI.
   */
  onNewBlock: function () {
    this.flux.actions.network.loadNetwork();
    this.flux.actions.asset.loadAssets();
    // We pull the branch's block-dependent period information from
    // contract calls that need to be called each block.
    this.flux.actions.branch.loadCurrentBranch();
    // TODO: We can skip loading events to report if the voting period hasn't changed.
    this.flux.actions.branch.loadEventsToReport();

    var currentBranch = this.flux.store('branch').getState().currentBranch;
    ethereumClient.checkQuorum(currentBranch.id);
  },

  startMonitoring: function () {
    var networkState = this.flux.store('network').getState()
    if (!networkState.isMonitoringBlocks) {
      var ethereumClient = this.flux.store('config').getEthereumClient();
      ethereumClient.startMonitoring(this.flux.actions.network.onNewBlock);
    }
  }
};

module.exports = NetworkActions;
