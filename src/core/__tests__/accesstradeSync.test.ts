import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../ledgerStore.js";
import { LogStore } from "../logStore.js";
import { syncAccesstradeTransactions } from "../accesstradeSync.js";

const ORDER_CONFIG = { taxPercent: 0, platformFeePercent: 0, userSharePercent: 80, maxCommissionRatioPercent: 1000 };
const SYNC_CONFIG_BASE = { apiKey: "test-key", apiBase: "https://api.accesstrade.vn", timeoutMs: 4000, lookbackDays: 30 };

function seedRequestLog(
  logStore: LogStore,
  subId: string,
  overrides: Partial<{ platform: "telegram" | "zalo"; userId: string; merchant: "shopee" | "tiktokshop" }> = {}
) {
  logStore.record({
    platform: overrides.platform ?? "zalo",
    merchant: overrides.merchant ?? "tiktokshop",
    userId: overrides.userId ?? "user-a",
    originalUrl: "https://tiktok.com/view/product/123",
    subId,
    outcome: "success",
    errorCode: null,
    affiliateUrl: "https://bot.example.com/s/abc",
  });
}

/** Cai dat 1 fetch gia lap tra ve dung 1 trang ket qua (khong phan trang) cho moi test. */
function mockFetchOnce(transactions: unknown[]) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ total: transactions.length, data: transactions }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("syncAccesstradeTransactions: ghi nhan don status=1+is_confirmed=1, doc subId tu utm_content", async () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  const restore = mockFetchOnce([
    {
      status: 1,
      is_confirmed: 1,
      transaction_id: "TX-001",
      transaction_value: 200_000,
      commission: 20_000,
      product_name: "San pham test",
      utm_content: "zalo-user-a-abc-def",
    },
  ]);
  try {
    seedRequestLog(logStore, "zalo-user-a-abc-def");
    const result = await syncAccesstradeTransactions(logStore, ledgerStore, {
      ...SYNC_CONFIG_BASE,
      recordOrderConfig: ORDER_CONFIG,
    });

    assert.equal(result.confirmedNew, 1);
    assert.equal(result.confirmedDuplicate, 0);
    assert.equal(result.reversedCount, 0);
    assert.equal(result.confirmedByUser.length, 1);
    assert.equal(result.confirmedByUser[0].userId, "user-a");
    assert.equal(result.confirmedByUser[0].items[0].productName, "San pham test");
    assert.equal(ledgerStore.getAvailableBalance("zalo", "user-a"), 16_000); // 80% cua 20_000
  } finally {
    restore();
    logStore.close();
    ledgerStore.close();
  }
});

test("syncAccesstradeTransactions: TikTok Shop utm_content rong, doc subId tu _extra.sub_params.sub1", async () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  const restore = mockFetchOnce([
    {
      status: 1,
      is_confirmed: 1,
      transaction_id: "TX-TIKTOK-001",
      transaction_value: 100_000,
      commission: 10_000,
      utm_content: "",
      _extra: { sub_params: { sub1: "zalo-user-b-xyz-999" } },
    },
  ]);
  try {
    seedRequestLog(logStore, "zalo-user-b-xyz-999", { userId: "user-b" });
    const result = await syncAccesstradeTransactions(logStore, ledgerStore, {
      ...SYNC_CONFIG_BASE,
      recordOrderConfig: ORDER_CONFIG,
    });

    assert.equal(result.confirmedNew, 1);
    assert.equal(ledgerStore.getAvailableBalance("zalo", "user-b"), 8_000);
  } finally {
    restore();
    logStore.close();
    ledgerStore.close();
  }
});

test("syncAccesstradeTransactions: chay 2 lan cung 1 giao dich -> lan 2 tinh la duplicate, khong cong trung", async () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  const tx = {
    status: 1,
    is_confirmed: 1,
    transaction_id: "TX-DUP-001",
    transaction_value: 200_000,
    commission: 20_000,
    utm_content: "zalo-user-a-abc-def",
  };
  try {
    seedRequestLog(logStore, "zalo-user-a-abc-def");

    const restore1 = mockFetchOnce([tx]);
    const first = await syncAccesstradeTransactions(logStore, ledgerStore, { ...SYNC_CONFIG_BASE, recordOrderConfig: ORDER_CONFIG });
    restore1();
    assert.equal(first.confirmedNew, 1);

    const restore2 = mockFetchOnce([tx]);
    const second = await syncAccesstradeTransactions(logStore, ledgerStore, { ...SYNC_CONFIG_BASE, recordOrderConfig: ORDER_CONFIG });
    restore2();
    assert.equal(second.confirmedNew, 0);
    assert.equal(second.confirmedDuplicate, 1);
    assert.equal(ledgerStore.getAvailableBalance("zalo", "user-a"), 16_000); // khong bi cong 2 lan
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

test("syncAccesstradeTransactions: status=2 (rejected) huy dung entry da confirmed truoc do", async () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seedRequestLog(logStore, "zalo-user-a-abc-def");

    const restoreConfirm = mockFetchOnce([
      {
        status: 1,
        is_confirmed: 1,
        transaction_id: "TX-REJ-001",
        transaction_value: 200_000,
        commission: 20_000,
        utm_content: "zalo-user-a-abc-def",
      },
    ]);
    await syncAccesstradeTransactions(logStore, ledgerStore, { ...SYNC_CONFIG_BASE, recordOrderConfig: ORDER_CONFIG });
    restoreConfirm();
    assert.equal(ledgerStore.getAvailableBalance("zalo", "user-a"), 16_000);

    const restoreReject = mockFetchOnce([
      {
        status: 2,
        is_confirmed: 0,
        transaction_id: "TX-REJ-001",
        transaction_value: 200_000,
        commission: 20_000,
        utm_content: "zalo-user-a-abc-def",
      },
    ]);
    const result = await syncAccesstradeTransactions(logStore, ledgerStore, { ...SYNC_CONFIG_BASE, recordOrderConfig: ORDER_CONFIG });
    restoreReject();

    assert.equal(result.reversedCount, 1);
    assert.equal(ledgerStore.getAvailableBalance("zalo", "user-a"), 0); // don bi huy, khong con tinh vao so du
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

test("syncAccesstradeTransactions: status=2 nhung chua tung ghi nhan truoc do -> khong lam gi", async () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  const restore = mockFetchOnce([
    {
      status: 2,
      is_confirmed: 0,
      transaction_id: "TX-NEVER-SEEN",
      transaction_value: 200_000,
      commission: 20_000,
      utm_content: "zalo-user-a-abc-def",
    },
  ]);
  try {
    seedRequestLog(logStore, "zalo-user-a-abc-def");
    const result = await syncAccesstradeTransactions(logStore, ledgerStore, {
      ...SYNC_CONFIG_BASE,
      recordOrderConfig: ORDER_CONFIG,
    });
    assert.equal(result.reversedCount, 0);
    assert.equal(result.errors.length, 0);
  } finally {
    restore();
    logStore.close();
    ledgerStore.close();
  }
});

test("syncAccesstradeTransactions: status=0 (hold) hoac is_confirmed=0 bi bo qua hoan toan", async () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  const restore = mockFetchOnce([
    { status: 0, is_confirmed: 0, transaction_id: "TX-HOLD-001", transaction_value: 100_000, commission: 10_000, utm_content: "zalo-user-a-abc-def" },
    { status: 1, is_confirmed: 0, transaction_id: "TX-UNCONFIRMED-001", transaction_value: 100_000, commission: 10_000, utm_content: "zalo-user-a-abc-def" },
  ]);
  try {
    seedRequestLog(logStore, "zalo-user-a-abc-def");
    const result = await syncAccesstradeTransactions(logStore, ledgerStore, {
      ...SYNC_CONFIG_BASE,
      recordOrderConfig: ORDER_CONFIG,
    });
    assert.equal(result.transactionsScanned, 2);
    assert.equal(result.confirmedNew, 0);
    assert.equal(result.reversedCount, 0);
    assert.equal(result.skippedNoSubId, 0);
    assert.equal(result.skippedSubIdNotFound, 0);
    assert.equal(ledgerStore.getAvailableBalance("zalo", "user-a"), 0);
  } finally {
    restore();
    logStore.close();
    ledgerStore.close();
  }
});

test("syncAccesstradeTransactions: subId khong khop request nao -> skippedSubIdNotFound", async () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  const restore = mockFetchOnce([
    {
      status: 1,
      is_confirmed: 1,
      transaction_id: "TX-ORPHAN-001",
      transaction_value: 100_000,
      commission: 10_000,
      utm_content: "zalo-khong-ton-tai-xyz",
    },
  ]);
  try {
    const result = await syncAccesstradeTransactions(logStore, ledgerStore, {
      ...SYNC_CONFIG_BASE,
      recordOrderConfig: ORDER_CONFIG,
    });
    assert.equal(result.confirmedNew, 0);
    assert.equal(result.skippedSubIdNotFound, 1);
  } finally {
    restore();
    logStore.close();
    ledgerStore.close();
  }
});
