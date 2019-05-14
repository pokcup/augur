import { prefixHex } from "speedomatic";
import { augur } from "services/augurjs";
import { EDGE_WALLET_TYPE } from "modules/common-elements/constants";
import { loadAccountData } from "modules/auth/actions/load-account-data";
import {
  updateAuthStatus,
  IS_LOGGED
} from "modules/auth/actions/update-auth-status";
import logError from "utils/log-error";

export const loginWithEdgeEthereumWallet = (
  edgeUiAccount: any,
  ethereumWallet: any,
  history: any
) => (dispatch: Function) => {
  const mixedCaseAddress: String = ethereumWallet.keys.ethereumAddress;
  const lowerCaseAddress: String = mixedCaseAddress.toLowerCase();
  dispatch(updateAuthStatus(IS_LOGGED, true));
  dispatch(
    loadAccountData({
      address: lowerCaseAddress,
      displayAddress: mixedCaseAddress,
      meta: {
        address: lowerCaseAddress,
        signer: (tx: any, callback: Function) => {
          edgeUiAccount
            .signEthereumTransaction(ethereumWallet.id, tx)
            .then(signed => callback(null, prefixHex(signed)))
            .catch(e => callback(e));
        },
        accountType: augur.rpc.constants.ACCOUNT_TYPES.EDGE
      },
      name: edgeUiAccount.username,
      edgeUiAccount
    })
  );
};

export const loginWithEdge = (
  edgeAccount: any,
  history: any,
  callback: Function = logError
) => (dispatch: Function) => {
  const ethereumWallet = edgeAccount.getFirstWalletInfo(EDGE_WALLET_TYPE);
  if (ethereumWallet != null) {
    return dispatch(
      loginWithEdgeEthereumWallet(edgeAccount, ethereumWallet, history)
    );
  }

  // Create an ethereum wallet if one doesn't exist
  edgeAccount
    .createCurrencyWallet(EDGE_WALLET_TYPE)
    .then(() => {
      const ethereumWallet = edgeAccount.getFirstWalletInfo(EDGE_WALLET_TYPE);
      dispatch(
        loginWithEdgeEthereumWallet(edgeAccount, ethereumWallet, history)
      );
    })
    .catch(() => logError({ code: 0, message: "could not create wallet" }));
};