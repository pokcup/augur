import { DB } from "../db/DB";
import * as _ from "lodash";
import {
  Augur,
  convertOnChainAmountToDisplayAmount,
  convertOnChainPriceToDisplayPrice,
  numTicksToTickSize
} from "../../index";
import { BigNumber } from "bignumber.js";
import { Getter } from "./Router";
import { getMarkets, Order, OrderState } from "./OnChainTrading";
import { StoredOrder } from "../db/ZeroXOrders";
import Dexie from "dexie";
import * as t from "io-ts";
import { getAddress } from "ethers/utils/address";
import { MarketData } from "../logs/types";

export interface ZeroXOrder extends Order {
  expirationTimeSeconds: BigNumber;
  makerAssetAmount: BigNumber;
  takerAssetAmount: BigNumber;
  salt: BigNumber;
  makerAssetData: string;
  takerAssetData: string;
  signature: string;
  makerFeeAssetData: string;
  takerFeeAssetData: string;
  feeRecipientAddress: string;
  takerAddress: string;
  makerAddress: string;
  senderAddress: string;
  makerFee: string;
  takerFee: string;
}

export interface ZeroXOrders {
  [marketId: string]: {
    [outcome: number]: {
      [orderType: string]: {
        [orderId: string]: ZeroXOrder;
      };
    };
  };
}

export const ZeroXOrdersParams = t.partial({
  marketId: t.string,
  outcome: t.number,
  orderType: t.string,
  account: t.string,
  orderState: t.string,
  matchPrice: t.string,
  ignoreOrders: t.array(t.string),
});

export const ZeroXOrderParams = t.type({
  orderHash: t.string,
});

export class ZeroXOrdersGetters {
  static GetZeroXOrdersParams = ZeroXOrdersParams;
  static GetZeroXOrderParams = ZeroXOrderParams;

  @Getter('GetZeroXOrderParams')
  static async getZeroXOrder(
    augur: Augur,
    db: DB,
    params: t.TypeOf<typeof ZeroXOrdersGetters.GetZeroXOrderParams>
  ): Promise<ZeroXOrder> {
    const storedOrder: StoredOrder = await db.ZeroXOrders.where('orderHash').equals(params.orderHash).last();
    const markets = await getMarkets([storedOrder.market], db, false);
    return ZeroXOrdersGetters.storedOrderToZeroXOrder(markets, storedOrder);
  }

  // TODO: Split this into a getter for orderbooks and a getter to get matching orders
  // TODO: When getting an orderbook for a specific market if the Database has not finished syncing we should just pull the orderbook from mesh directly
  @Getter('GetZeroXOrdersParams')
  static async getZeroXOrders(
    augur: Augur,
    db: DB,
    params: t.TypeOf<typeof ZeroXOrdersGetters.GetZeroXOrdersParams>
  ): Promise<ZeroXOrders> {

    if (!params.marketId && !params.account) {
      throw new Error("'getOrders' requires 'marketId' or 'account' param be provided");
    }

    const outcome = params.outcome
      ? `0x0${params.outcome.toString()}`
      : null;
    const orderType = params.orderType ? `0x0${params.orderType}` : null;
    const account = params.account ? getAddress(params.account) : null;

    let storedOrders: StoredOrder[];
    if (!params.marketId && account) {
      storedOrders = await db.ZeroXOrders.where({orderCreator: account})
        .toArray();
    } else if (!outcome || !orderType) {
      storedOrders = await db.ZeroXOrders.where(
        '[market+outcome+orderType]'
      )
        .between(
          [params.marketId, Dexie.minKey, Dexie.minKey],
          [params.marketId, Dexie.maxKey, Dexie.maxKey]
        )
        .and(order => {
          return !account || order.orderCreator === account;
        })
        .toArray();
    } else {
      storedOrders = await db.ZeroXOrders.where('[market+outcome+orderType]')
        .equals([params.marketId, outcome, orderType])
        .and(order => !account || order.orderCreator === account)
        .toArray();
    }

    if (params.matchPrice) {
      if (!params.orderType) throw new Error('Cannot specify match price without order type');

      const price = new BigNumber(params.matchPrice, 16);
      storedOrders = _.filter(storedOrders, storedOrder => {
        // 0 == "buy"
        const orderPrice = new BigNumber(storedOrder.price, 16);
        return params.orderType == '0' ? orderPrice.gte(price) : orderPrice.lte(price);
      });
    }

    const marketIds: string[] = await storedOrders
      .reduce((ids, order) => Array.from(new Set([...ids, order.market])), []);
    const markets = await getMarkets(marketIds, db, false);

    return ZeroXOrdersGetters.mapStoredToZeroXOrders(markets, storedOrders, params.ignoreOrders || []);
  }

  static mapStoredToZeroXOrders(markets: _.Dictionary<MarketData>, storedOrders: StoredOrder[], ignoredOrderIds: string[]): ZeroXOrders {
    let orders = storedOrders.map((storedOrder) => {
      return {
        storedOrder,
        zeroXOrder: ZeroXOrdersGetters.storedOrderToZeroXOrder(markets, storedOrder)
      }
    });
    // Remove orders somehow belonging to unknown markets
    orders = orders.filter((order) => order.zeroXOrder !== null);
    // Remove intentionally ignored orders.
    orders = orders.filter((order) => ignoredOrderIds.indexOf(order.zeroXOrder.orderId) === -1);
    // Shape orders into market-order-type tree.
    return orders.reduce((orders: ZeroXOrders, order): ZeroXOrders => {
      const { storedOrder, zeroXOrder } = order;
      const { market } = storedOrder;
      const { orderId } = zeroXOrder;
      const outcome = new BigNumber(storedOrder.outcome).toNumber();
      const orderType = new BigNumber(storedOrder.orderType).toNumber();

      if (!orders[market]) {
        orders[market] = {};
      }
      if (!orders[market][outcome]) {
        orders[market][outcome] = {};
      }
      if (!orders[market][outcome][orderType]) {
        orders[market][outcome][orderType] = {};
      }

      orders[market][outcome][orderType][orderId] = zeroXOrder;
      return orders;
    }, {} as ZeroXOrders)
  }

  static storedOrderToZeroXOrder(markets: _.Dictionary<MarketData>, storedOrder: StoredOrder): ZeroXOrder {
    const market = markets[storedOrder.market];
    if (!market) {
      return null; // cannot convert orders unaffiliated with any known market
    }

    const minPrice = new BigNumber(market.prices[0]);
    const maxPrice = new BigNumber(market.prices[1]);
    const numTicks = new BigNumber(market.numTicks);
    const tickSize = numTicksToTickSize(numTicks, minPrice, maxPrice);
    const amount = convertOnChainAmountToDisplayAmount(
      new BigNumber(storedOrder.amount),
      tickSize
    ).toString(10);
    const amountFilled = convertOnChainAmountToDisplayAmount(
      new BigNumber(storedOrder.signedOrder.makerAssetAmount).minus(
        new BigNumber(storedOrder.amount)
      ),
      tickSize
    ).toString(10);
    const price = convertOnChainPriceToDisplayPrice(
      new BigNumber(storedOrder.price, 16),
      minPrice,
      tickSize
    ).toString(10);

    return {
      owner: storedOrder.signedOrder.makerAddress,
      orderState: OrderState.OPEN,
      orderId: storedOrder['_id'] || storedOrder.orderHash,
      price,
      amount,
      amountFilled,
      expirationTimeSeconds: new BigNumber(storedOrder.signedOrder.expirationTimeSeconds),
      fullPrecisionPrice: price,
      fullPrecisionAmount: amount,
      originalFullPrecisionAmount: '0',
      makerAssetAmount: new BigNumber(storedOrder.signedOrder.makerAssetAmount),
      takerAssetAmount: new BigNumber(storedOrder.signedOrder.takerAssetAmount),
      salt: new BigNumber(storedOrder.signedOrder.salt),
      makerAssetData: storedOrder.signedOrder.makerAssetData,
      takerAssetData: storedOrder.signedOrder.takerAssetData,
      signature: storedOrder.signedOrder.signature,
      makerFeeAssetData: '0x',
      takerFeeAssetData: '0x',
      feeRecipientAddress: storedOrder.signedOrder.feeRecipientAddress,
      takerAddress: storedOrder.signedOrder.takerAddress,
      makerAddress: storedOrder.signedOrder.makerAddress,
      senderAddress: storedOrder.signedOrder.senderAddress,
      makerFee: storedOrder.signedOrder.makerFee,
      takerFee: storedOrder.signedOrder.takerFee,
    } as ZeroXOrder ; // TODO this is hiding some missing properties
  }
}
