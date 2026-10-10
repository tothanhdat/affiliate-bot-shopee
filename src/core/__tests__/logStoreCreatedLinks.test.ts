import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LogStore } from "../logStore.js";

/**
 * Trang /admin/links liet ke MOI luot tao link (ke ca luot loi) kem ten san pham + hoa hong uoc
 * tinh + noi gui (group/DM). 3 cot do la cot MOI tren bang requests nen phai co migration, va
 * list/count/totals phai loc y het nhau neu khong thi so trang se khong khop so dong.
 */

function makeStore(): LogStore {
  return new LogStore(":memory:");
}

function recordLink(
  store: LogStore,
  overrides: Partial<Parameters<LogStore["record"]>[0]> = {}
): ReturnType<LogStore["record"]> {
  return store.record({
    platform: "zalo",
    merchant: "shopee",
    userId: "u1",
    originalUrl: "https://shopee.vn/product/1/2",
    subId: "k-u1-abc-1",
    outcome: "success",
    errorCode: null,
    affiliateUrl: "https://bot.example/s/aaaaaaa",
    ...overrides,
  });
}

test("record() luu va doc lai duoc productName/commissionEstimate/sourceContext", () => {
  const store = makeStore();
  try {
    recordLink(store, {
      productName: "Máy Ảnh Canon EOS R50",
      commissionEstimate: 40000,
      sourceContext: "group",
    });

    const rows = store.listCreatedLinks();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].productName, "Máy Ảnh Canon EOS R50");
    assert.equal(rows[0].commissionEstimate, 40000);
    assert.equal(rows[0].sourceContext, "group");
  } finally {
    store.close();
  }
});

test("record() khong truyen 3 field moi -> doc lai ra null, khong phai undefined", () => {
  const store = makeStore();
  try {
    recordLink(store);

    const rows = store.listCreatedLinks();
    assert.equal(rows[0].productName, null);
    assert.equal(rows[0].commissionEstimate, null);
    assert.equal(rows[0].sourceContext, null);
  } finally {
    store.close();
  }
});

test("commissionEstimate = 0 giu nguyen 0, KHONG bien thanh null", () => {
  // 0 la cau tra loi THAT "san pham chua bat hoa hong" (da xac minh tu nguon), khac han null la
  // "khong tra duoc". Gop lai thi trang admin se noi sai ve san pham do - xem commissionLookup.ts.
  const store = makeStore();
  try {
    recordLink(store, { commissionEstimate: 0 });

    assert.equal(store.listCreatedLinks()[0].commissionEstimate, 0);
  } finally {
    store.close();
  }
});

test("listCreatedLinks tra ve CA luot loi, kem errorCode va affiliateUrl null", () => {
  const store = makeStore();
  try {
    recordLink(store, {
      outcome: "error",
      merchant: null,
      subId: null,
      affiliateUrl: null,
      errorCode: "NOT_A_PRODUCT_LINK",
      sourceContext: "dm",
    });

    const rows = store.listCreatedLinks();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].outcome, "error");
    assert.equal(rows[0].errorCode, "NOT_A_PRODUCT_LINK");
    assert.equal(rows[0].affiliateUrl, null);
    assert.equal(rows[0].sourceContext, "dm");
  } finally {
    store.close();
  }
});

test("loc theo outcome: 'error' chi tra luot loi, khong truyen thi tra ca hai", () => {
  const store = makeStore();
  try {
    recordLink(store, { subId: "ok" });
    recordLink(store, { subId: null, outcome: "error", errorCode: "E1", affiliateUrl: null });

    assert.equal(store.listCreatedLinks({ outcome: "error" }).length, 1);
    assert.equal(store.listCreatedLinks({ outcome: "error" })[0].errorCode, "E1");
    assert.equal(store.listCreatedLinks().length, 2);
  } finally {
    store.close();
  }
});

test("loc theo platform va theo userId khop CHINH XAC", () => {
  const store = makeStore();
  try {
    recordLink(store, { platform: "zalo", userId: "123" });
    recordLink(store, { platform: "telegram", userId: "1234" });

    assert.equal(store.listCreatedLinks({ platform: "telegram" }).length, 1);

    // userId khop chinh xac: "123" khong duoc keo theo "1234" (bam tu /admin/users sang phai ra
    // dung mot user).
    const exact = store.listCreatedLinks({ userId: "123" });
    assert.equal(exact.length, 1);
    assert.equal(exact[0].platform, "zalo");
  } finally {
    store.close();
  }
});

test("search khop mot phan userId / tenSanPham / linkGoc", () => {
  const store = makeStore();
  try {
    recordLink(store, { userId: "zalo-9988", productName: "Gối massage", originalUrl: "https://shopee.vn/a" });
    recordLink(store, { userId: "u2", productName: "Máy ảnh Canon", originalUrl: "https://shopee.vn/canon-i.1.2" });

    assert.equal(store.listCreatedLinks({ search: "9988" }).length, 1);
    assert.equal(store.listCreatedLinks({ search: "massage" })[0].userId, "zalo-9988");
    assert.equal(store.listCreatedLinks({ search: "canon-i" })[0].userId, "u2");
  } finally {
    store.close();
  }
});

test("search escape '%' va '_' - go '1_2' khong duoc khop '132'", () => {
  const store = makeStore();
  try {
    recordLink(store, { userId: "132" });
    recordLink(store, { userId: "1_2" });

    const rows = store.listCreatedLinks({ search: "1_2" });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].userId, "1_2");
  } finally {
    store.close();
  }
});

test("countCreatedLinks khop dung so dong listCreatedLinks tra ve voi CUNG bo loc", () => {
  // Lech nhau la so trang khong khop so dong - bay da gap o listCommissionEntries.
  const store = makeStore();
  try {
    recordLink(store, { userId: "a", productName: "Gối massage" });
    recordLink(store, { userId: "b", productName: "Gối massage" });
    recordLink(store, { userId: "c", productName: "Máy ảnh", outcome: "error", errorCode: "E", affiliateUrl: null });

    const filters = { search: "Gối" };
    assert.equal(store.countCreatedLinks(filters), store.listCreatedLinks(filters).length);
    assert.equal(store.countCreatedLinks(filters), 2);
    assert.equal(store.countCreatedLinks(), 3);
  } finally {
    store.close();
  }
});

test("phan trang: limit/offset cat dung, khong trung khong sot", () => {
  const store = makeStore();
  try {
    for (let i = 0; i < 5; i++) {
      recordLink(store, { userId: `u${i}`, timestamp: `2026-10-0${i + 1}T00:00:00.000Z` });
    }

    const page1 = store.listCreatedLinks(undefined, { limit: 2, offset: 0 });
    const page2 = store.listCreatedLinks(undefined, { limit: 2, offset: 2 });
    assert.deepEqual(
      page1.map((r) => r.userId),
      ["u4", "u3"]
    );
    assert.deepEqual(
      page2.map((r) => r.userId),
      ["u2", "u1"]
    );
  } finally {
    store.close();
  }
});

test("cung timestamp den mili-giay van xep on dinh, khong trung/sot giua cac trang", () => {
  // 1 tin nhan nhieu link -> nhieu row ghi trong cung mili-giay. Thieu tiebreak thi SQLite tra
  // thu tu tuy y moi lan query, trang 1 va trang 2 co the chung mot dong.
  const store = makeStore();
  try {
    const sameMoment = "2026-10-05T03:04:05.000Z";
    for (let i = 0; i < 4; i++) {
      recordLink(store, { userId: `u${i}`, timestamp: sameMoment });
    }

    const page1 = store.listCreatedLinks(undefined, { limit: 2, offset: 0 }).map((r) => r.userId);
    const page2 = store.listCreatedLinks(undefined, { limit: 2, offset: 2 }).map((r) => r.userId);

    assert.equal(new Set([...page1, ...page2]).size, 4);
  } finally {
    store.close();
  }
});

test("getCreatedLinksTotals tinh tren DUNG bo loc dang ap", () => {
  const store = makeStore();
  try {
    recordLink(store, { userId: "a", platform: "zalo", commissionEstimate: 10000 });
    recordLink(store, { userId: "b", platform: "zalo", commissionEstimate: 5000 });
    recordLink(store, {
      userId: "c",
      platform: "telegram",
      commissionEstimate: 999999,
      outcome: "error",
      errorCode: "E",
      affiliateUrl: null,
    });
    recordLink(store, { userId: "d", platform: "telegram", outcome: "error", errorCode: "E", affiliateUrl: null });

    const all = store.getCreatedLinksTotals();
    assert.equal(all.total, 4);
    assert.equal(all.success, 2);
    assert.equal(all.errors, 2);
    assert.equal(all.distinctUsers, 4);

    const zaloOnly = store.getCreatedLinksTotals({ platform: "zalo" });
    assert.equal(zaloOnly.total, 2);
    assert.equal(zaloOnly.commissionEstimateTotal, 15000);
  } finally {
    store.close();
  }
});

test("commissionEstimateTotal KHONG cong luot loi - luot do khong tao ra link nao", () => {
  const store = makeStore();
  try {
    recordLink(store, { commissionEstimate: 10000 });
    recordLink(store, {
      userId: "x",
      commissionEstimate: 777000,
      outcome: "error",
      errorCode: "E",
      affiliateUrl: null,
    });

    assert.equal(store.getCreatedLinksTotals().commissionEstimateTotal, 10000);
  } finally {
    store.close();
  }
});

test("migration: DB tao bang schema CU (thieu 3 cot) mo duoc, du lieu cu con nguyen", () => {
  const dir = mkdtempSync(join(tmpdir(), "logstore-migration-"));
  const dbPath = join(dir, "log.db");
  try {
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      CREATE TABLE requests (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        platform TEXT NOT NULL,
        merchant TEXT,
        user_id TEXT NOT NULL,
        original_url TEXT NOT NULL,
        sub_id TEXT,
        outcome TEXT NOT NULL,
        error_code TEXT,
        affiliate_url TEXT
      );
    `);
    legacy
      .prepare(
        `INSERT INTO requests (id, timestamp, platform, merchant, user_id, original_url, sub_id, outcome, error_code, affiliate_url)
         VALUES ('old-1', '2026-09-01T10:00:00.000Z', 'zalo', 'shopee', 'old-user', 'https://shopee.vn/x', 'k-old', 'success', NULL, 'https://bot.example/s/old')`
      )
      .run();
    legacy.close();

    const store = new LogStore(dbPath);
    try {
      const rows = store.listCreatedLinks();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].userId, "old-user");
      // Khong backfill: 3 field moi ve null chu khong phai so/chuoi bia ra.
      assert.equal(rows[0].productName, null);
      assert.equal(rows[0].commissionEstimate, null);
      assert.equal(rows[0].sourceContext, null);
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Bo loc khoang ngay (2026-10-08) - cat theo NGAY GIO VN, khong phai gio UTC.
test("loc tu ngay den ngay: CA HAI dau khoang deu tinh vao", () => {
  const store = makeStore();
  try {
    recordLink(store, { userId: "u1", timestamp: "2026-10-01T05:00:00.000Z" });
    recordLink(store, { userId: "u2", timestamp: "2026-10-03T05:00:00.000Z" });
    recordLink(store, { userId: "u3", timestamp: "2026-10-05T05:00:00.000Z" });

    const rows = store.listCreatedLinks({ fromDate: "2026-10-01", toDate: "2026-10-03" });
    assert.deepEqual(
      rows.map((r) => r.userId).sort(),
      ["u1", "u2"]
    );
  } finally {
    store.close();
  }
});

test("cat ngay theo GIO VN (+7), khong phai gio UTC", () => {
  // Railway chay UTC. 2026-10-01T18:30Z la 01:30 ngay 02/10 gio VN - admin loc "ngay 02/10" phai
  // thay no, loc "ngay 01/10" thi khong. Cat theo UTC se bao cao nham sang hom truoc suot 7 tieng
  // moi ngay, dung vao khung gio doi soat 9h30 sang.
  const store = makeStore();
  try {
    recordLink(store, { userId: "khuya", timestamp: "2026-10-01T18:30:00.000Z" });

    assert.equal(store.listCreatedLinks({ fromDate: "2026-10-02", toDate: "2026-10-02" }).length, 1);
    assert.equal(store.listCreatedLinks({ fromDate: "2026-10-01", toDate: "2026-10-01" }).length, 0);
  } finally {
    store.close();
  }
});

test("chi truyen fromDate = tu ngay do tro di; chi truyen toDate = den het ngay do", () => {
  const store = makeStore();
  try {
    recordLink(store, { userId: "cu", timestamp: "2026-09-20T05:00:00.000Z" });
    recordLink(store, { userId: "moi", timestamp: "2026-10-05T05:00:00.000Z" });

    assert.deepEqual(
      store.listCreatedLinks({ fromDate: "2026-10-01" }).map((r) => r.userId),
      ["moi"]
    );
    assert.deepEqual(
      store.listCreatedLinks({ toDate: "2026-09-30" }).map((r) => r.userId),
      ["cu"]
    );
  } finally {
    store.close();
  }
});

test("khoang ngay ap dung cho CA count lan totals, khong chi bang", () => {
  const store = makeStore();
  try {
    recordLink(store, { userId: "trong", timestamp: "2026-10-02T05:00:00.000Z", commissionEstimate: 5000 });
    recordLink(store, { userId: "ngoai", timestamp: "2026-10-09T05:00:00.000Z", commissionEstimate: 99000 });

    const filters = { fromDate: "2026-10-01", toDate: "2026-10-03" };
    assert.equal(store.countCreatedLinks(filters), 1);
    assert.equal(store.getCreatedLinksTotals(filters).total, 1);
    assert.equal(store.getCreatedLinksTotals(filters).commissionEstimateTotal, 5000);
  } finally {
    store.close();
  }
});

// Loc theo gio phut (2026-10-10): fromDate/toDate nhan them "YYYY-MM-DDTHH:mm" (GIO VN).
test("loc theo gio phut GIO VN: 'den HH:mm' tinh het phut do (ke ca giay :59)", () => {
  const store = makeStore();
  try {
    // VN = UTC + 7. 22:59:59 VN = 15:59:59Z ... 00:00:00 ngay 10/10 VN = 17:00:00Z.
    recordLink(store, { userId: "a-22h59", timestamp: "2026-10-09T15:59:59.000Z" });
    recordLink(store, { userId: "b-23h00", timestamp: "2026-10-09T16:00:00.000Z" });
    recordLink(store, { userId: "c-23h59s59", timestamp: "2026-10-09T16:59:59.999Z" });
    recordLink(store, { userId: "d-00h00", timestamp: "2026-10-09T17:00:00.000Z" });

    const rows = store.listCreatedLinks({ fromDate: "2026-10-09T23:00", toDate: "2026-10-09T23:59" });
    assert.deepEqual(rows.map((r) => r.userId).sort(), ["b-23h00", "c-23h59s59"]);
  } finally {
    store.close();
  }
});

test("chi co 1 dau co gio: tu gio do tro di / den het phut do", () => {
  const store = makeStore();
  try {
    recordLink(store, { userId: "sang", timestamp: "2026-10-09T02:00:00.000Z" }); // 09:00 VN
    recordLink(store, { userId: "chieu", timestamp: "2026-10-09T08:00:00.000Z" }); // 15:00 VN
    assert.deepEqual(
      store.listCreatedLinks({ fromDate: "2026-10-09T12:00" }).map((r) => r.userId),
      ["chieu"]
    );
    assert.deepEqual(
      store.listCreatedLinks({ toDate: "2026-10-09T12:00" }).map((r) => r.userId),
      ["sang"]
    );
  } finally {
    store.close();
  }
});

test("KPI va danh sach dung CHUNG bo loc theo gio (so liet ke khop so dem)", () => {
  const store = makeStore();
  try {
    recordLink(store, { userId: "trong", timestamp: "2026-10-09T16:30:00.000Z" });
    recordLink(store, { userId: "ngoai", timestamp: "2026-10-09T10:00:00.000Z" });
    const filters = { fromDate: "2026-10-09T23:00", toDate: "2026-10-09T23:59" };
    assert.equal(store.listCreatedLinks(filters).length, 1);
    assert.equal(store.countCreatedLinks(filters), 1);
    assert.equal(store.getCreatedLinksTotals(filters).total, 1);
  } finally {
    store.close();
  }
});

// Tim theo Sub_id (2026-10-10): dung de do nguoc tu Sub_id1-5 cua bao cao Shopee ve dung luot tao link.
test("search khop mot phan sub_id (ca chuoi day du lan doan giua/cuoi)", () => {
  const store = makeStore();
  try {
    recordLink(store, { userId: "u1", subId: "k-2233805738531852881-mv17ndbz-18d664" });
    recordLink(store, { userId: "u2", subId: "k-7777-mv17zzzz-aa11bb" });
    recordLink(store, { userId: "u3", subId: null, outcome: "error", errorCode: "INVALID_LINK", affiliateUrl: null });

    const full = store.listCreatedLinks({ search: "k-2233805738531852881-mv17ndbz-18d664" });
    assert.deepEqual(full.map((r) => r.userId), ["u1"]);
    assert.deepEqual(store.listCreatedLinks({ search: "mv17ndbz" }).map((r) => r.userId), ["u1"]);
    assert.deepEqual(store.listCreatedLinks({ search: "aa11bb" }).map((r) => r.userId), ["u2"]);
    // Dong khong co sub_id (NULL) khong bi khop nham va khong lam loi truy van.
    assert.equal(store.listCreatedLinks({ search: "mv17" }).length, 2);
  } finally {
    store.close();
  }
});

test("search sub_id van escape '_' va '%' (go 'k_u' khong khop 'kxu')", () => {
  const store = makeStore();
  try {
    recordLink(store, { userId: "u1", subId: "kxu-1" });
    assert.equal(store.listCreatedLinks({ search: "k_u" }).length, 0);
    assert.equal(store.listCreatedLinks({ search: "100%" }).length, 0);
  } finally {
    store.close();
  }
});

test("tim theo sub_id: danh sach, dem va KPI dung chung bo loc", () => {
  const store = makeStore();
  try {
    recordLink(store, { userId: "u1", subId: "k-abc-111" });
    recordLink(store, { userId: "u2", subId: "k-xyz-222" });
    const filters = { search: "abc-111" };
    assert.equal(store.listCreatedLinks(filters).length, 1);
    assert.equal(store.countCreatedLinks(filters), 1);
    assert.equal(store.getCreatedLinksTotals(filters).total, 1);
  } finally {
    store.close();
  }
});
