#!/usr/bin/env bash
trap "kill 0" EXIT

set -ex;

export USE_POPULATED_CONTRACTS="${USE_POPULATED_CONTRACTS:-true}"

export USE_NORMAL_TIME=${USE_NORMAL_TIME:-false}
export ETHEREUM_HOST=${ETHEREUM_HOST:-127.0.0.1}
export ETHEREUM_GAS_PRICE_IN_NANOETH=${ETHEREUM_GAS_PRICE_IN_NANOETH:-1}
export ETHEREUM_HTTP=${ETHEREUM_HTTP:-http://127.0.0.1:8545}
export ETHEREUM_WS=${ETHEREUM_WS:-http://127.0.0.1:8546}

export ETHEREUM_PRIVATE_KEY=${ETHEREUM_PRIVATE_KEY:-fae42052f82bed612a724fec3632f325f377120592c75bb78adfcceae6470c5a}

if [ "$(docker ps -a | grep geth-node)" ]; then
  echo "Kill running container...";
  docker kill geth-node
fi

cd ../;

if $USE_POPULATED_CONTRACTS; then
  echo "Using deployed contracts"

  npm run docker:pull
  npm run docker:geth:pop
else
  npm run docker:geth
  yarn run deploy:environment
fi

popd;

echo "Start augur (UI)";
pushd augur;
rm -rf node_modules;
yarn;
yarn run dev &

wait
