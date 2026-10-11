import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../ledgerStore.js";
import { LogStore } from "../logStore.js";
import { importTiktokOrders } from "../tiktokOrderImport.js";

/**
 * CHOT CACH LY (spec 6.1): dong bo TikTok khong bao gio duoc ghi mot don Shopee. subId chi ma hoa
 * NEN TANG CHAT (k/m/w), khong ma hoa san, nen findBySubId co the tra ve mot request Shopee.
 */
const CONFIG = {
  recordOrderConfig: {
    taxPercent: 0,
    platformFeePercent: 0,
    userSharePercent: 100,
    maxCommissionRatioPercent: 1000,
    holdConfig: { thresholdVnd: 0, holdDays: 0 },
  },
};

test("don TikTok mang sub_id cua mot request SHOPEE -> bo qua + canh bao, ledger KHONG them dong nao", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    logStore.record({
      platform: "zalo",
      merchant: "shopee",
      userId: "user-a",
      originalUrl: "https://shopee.vn/product/1/2",
      subId: "k-user-a-abc-def",
      outcome: "success",
      errorCode: null,
      affiliateUrl: "https://s.shopee.vn/x",
    });
    const result = importTiktokOrders(logStore, ledgerStore, CONFIG, [
      {
        order_id: "TT-LAC",
        sku_id: "S1",
        sub_id: "k-user-a-abc-def",
        status: 2,
        commission_gmv: "100000.00",
        est_commission: "5000.00",
        actual_commission: "4500.00",
        time_created_iso: "2026-10-08T06:52:18Z",
      },
    ]);

    assert.equal(result.skippedForeignMerchant, 1);
    assert.equal(result.confirmedNew, 0);
    assert.equal(result.pendingNew, 0);
    assert.deepEqual(result.newOrderIds, []);
    assert.ok(result.errors.some((e) => /TT-LAC/.test(e) && /shopee/.test(e)));
    assert.equal(ledgerStore.getEntryByOrderId("shopee", "TT-LAC"), null);
    assert.equal(ledgerStore.getEntryByOrderId("tiktokshop", "TT-LAC"), null);
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});
