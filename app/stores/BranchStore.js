var Fluxxor = require('fluxxor');
var constants = require('../libs/constants');

var state = {
  branches: {},
  // currentBranch: { id: process.env.AUGUR_BRANCH_ID || constants.DEV_BRANCH_ID },
  currentBranch: { id: constants.DEV_BRANCH_ID },
  eventsToReport: []
};

var BranchStore = Fluxxor.createStore({

  initialize: function () {
    this.bindActions(
      constants.branch.LOAD_BRANCHES_SUCCESS, this.handleLoadBranchesSuccess,
      constants.branch.LOAD_EVENTS_TO_REPORT_SUCCESS, this.handleLoadEventsToReportSuccess,
      constants.branch.LOAD_CURRENT_BRANCH_SUCCESS, this.handleUpdateCurrentBranchSuccess
    );
  },

  getState: function () {
    return state;
  },

  handleLoadBranchesSuccess: function (payload) {
    state.branches = payload.branches;
    this.emit(constants.CHANGE_EVENT);
  },

  handleLoadEventsToReportSuccess: function (payload) {
    state.eventsToReport = payload.eventsToReport;
    this.emit(constants.CHANGE_EVENT);
  },

  handleUpdateCurrentBranchSuccess: function (payload) {
    state.currentBranch = payload.currentBranch;
    this.emit(constants.CHANGE_EVENT);
  }
});

module.exports = BranchStore;
