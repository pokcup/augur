import { OrderInfo, WSClient, OrderEvent, ValidationResults, AcceptedOrderInfo } from '@0x/mesh-rpc-client';
import { orderHashUtils } from '@0x/order-utils';
import * as _ from 'lodash';
import BigNumber from 'bignumber.js';


export interface Order {
  chainId: number;
  exchangeAddress: string;
  makerAddress: string;
  takerAddress: string;
  feeRecipientAddress: string;
  senderAddress: string;
  makerAssetAmount: BigNumber;
  takerAssetAmount: BigNumber;
  makerFee: BigNumber;
  takerFee: BigNumber;
  expirationTimeSeconds: BigNumber;
  salt: BigNumber;
  makerAssetData: string;
  takerAssetData: string;
  makerFeeAssetData: string;
  takerFeeAssetData: string;
}

export interface SignedOrder extends Order {
  signature: string;
}

export class MockBrowserMesh {
    readonly meshClient: WSClient;
    readonly orders: {[orderHash: string]: OrderInfo};
    private errorCallback: (err: Error) => void = console.log;
    private orderEventsCallback: (events: OrderEvent[]) => void;

    constructor(meshClient: WSClient) {
        this.meshClient = meshClient;
        this.orders = {};
    }

    async startAsync(): Promise<void> {
        return;
    }

    onError(handler: (err: Error) => void): void {
        this.errorCallback = handler;
    }

    onOrderEvents(handler: (events: OrderEvent[]) => void): void {
        this.orderEventsCallback = handler;
    }

    async addOrdersAsync(orders: SignedOrder[]): Promise<ValidationResults> {
        const accepted = [];
        const rejected = [];
        try {
            for (const order of orders) {
                const orderHash = orderHashUtils.getOrderHashHex(order);
                const storedOrder: AcceptedOrderInfo = {
                    orderHash,
                    signedOrder: order,
                    fillableTakerAssetAmount: order.takerAssetAmount,
                    isNew: true
                }
                this.orders[orderHash] = storedOrder;
                accepted.push(storedOrder);
            }
            this.broadcastOrders(orders);
        } catch (err) {
            if (this.errorCallback) {
                this.errorCallback(err);
            }
        }
        this.notifySubscribersOrderAdded(accepted);
        return {
            accepted,
            rejected
        }
    }

    broadcastOrders(orders: SignedOrder[]): void {
        this.meshClient.addOrdersAsync(orders);
    }

    notifySubscribersOrderAdded(orders: OrderEvent[]): void {
        if (this.orderEventsCallback) {
            this.orderEventsCallback(orders);
        }
    }
}
