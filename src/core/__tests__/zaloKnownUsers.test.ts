import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../ledgerStore.js";

/**
 * Trang /admin/users phai hien CA user chua tung dat don (2026-10-09, yeu cau truc tiep cua user):
 * khong co ho trong danh sach thi khong co cho nao bam vao de cau hinh % hoa hong rieng TRUOC khi
 * ho mua lan dau. Nguon la bang zalo_known_users (moi user Zalo bot TUNG thay trong group khach
 * hang), hop nhat voi commission_entries trong listUsers().
 */

function tickedGroup(store: LedgerStore, groupId: string): void {
  store.upsertZaloGroup(groupId, `Group ${groupId}`);
  store.setZaloGroupNotifySelection([groupId]);
}

function recordOrder(store: LedgerStore, userId: string, orderId: string): void {
  store.recordConversion({
    subId: `k-${userId}-abc-def`,
    platform: "zalo",
    userId,
    merchant: "shopee",
    orderId,
    orderAmount: 500_000,
    commissionAmount: 100_000,
    taxPercent: 0,
    platformFeePercent: 0,
    userSharePercent: 80,
    maxCommissionRatioPercent: 1000,
    holdConfig: { thresholdVnd: 0, holdDays: 0 },
  });
}

test("listUsers: thanh vien group khach hang chua co don nao van hien ra voi so 0", () => {
  const store = new LedgerStore(":memory:");
  try {
    tickedGroup(store, "group-1");
    store.upsertUserProfile("zalo", "member-a", "Thao Nguyen");
    store.upsertZaloKnownUser("group-1", "member-a");

    const row = store.listUsers().find((u) => u.userId === "member-a");
    assert.ok(row, "user chua co don phai co trong danh sach");
    assert.equal(row.platform, "zalo");
    assert.equal(row.displayName, "Thao Nguyen");
    assert.equal(row.availableBalance, 0);
    assert.equal(row.pendingBalance, 0);
    assert.equal(row.paidTotal, 0);
    assert.equal(row.debtRemaining, 0);
    assert.equal(row.heldBalance, 0);
    assert.equal(row.commissionOverride, null);
  } finally {
    store.close();
  }
});

/**
 * Cai bay cua phep union: cau cu dung COUNT(*) tren "FROM commission_entries", doi sang
 * "FROM <danh sach user> LEFT JOIN commission_entries" thi COUNT(*) dem ca DONG RONG cua LEFT JOIN
 * -> user chua co don nao bao cao la "1 don". Phai dem COUNT(ce.order_id).
 */
test("listUsers: user chua co don dem 0 don (khong phai 1 vi LEFT JOIN)", () => {
  const store = new LedgerStore(":memory:");
  try {
    tickedGroup(store, "group-1");
    store.upsertZaloKnownUser("group-1", "member-a");

    const row = store.listUsers().find((u) => u.userId === "member-a");
    assert.equal(row?.ordersCount, 0);
  } finally {
    store.close();
  }
});

test("listUsers: thanh vien group DA co don khong bi dem trung so don", () => {
  const store = new LedgerStore(":memory:");
  try {
    tickedGroup(store, "group-1");
    store.upsertZaloKnownUser("group-1", "member-a");
    recordOrder(store, "member-a", "order-1");
    recordOrder(store, "member-a", "order-2");

    const rows = store.listUsers().filter((u) => u.userId === "member-a");
    assert.equal(rows.length, 1, "1 user = 1 dong, khong nhan ban theo so group");
    assert.equal(rows[0].ordersCount, 2);
    assert.equal(rows[0].availableBalance, 160_000);
  } finally {
    store.close();
  }
});

test("listUsers: user o trong 2 group khach hang van chi la 1 dong", () => {
  const store = new LedgerStore(":memory:");
  try {
    store.upsertZaloGroup("group-1", "Group 1");
    store.upsertZaloGroup("group-2", "Group 2");
    store.setZaloGroupNotifySelection(["group-1", "group-2"]);
    store.upsertZaloKnownUser("group-1", "member-a");
    store.upsertZaloKnownUser("group-2", "member-a");

    assert.equal(store.listUsers().filter((u) => u.userId === "member-a").length, 1);
  } finally {
    store.close();
  }
});

test("listUsers: thanh vien group CHUA tick thong bao khong hien (group ca nhan cua chu bot)", () => {
  const store = new LedgerStore(":memory:");
  try {
    store.upsertZaloGroup("group-gia-dinh", "Gia dinh");
    store.upsertZaloKnownUser("group-gia-dinh", "nguoi-than");

    assert.equal(
      store.listUsers().find((u) => u.userId === "nguoi-than"),
      undefined
    );
  } finally {
    store.close();
  }
});

/**
 * Phep loc notify_enabled dat o LUC DOC co chu dich: bo tick mot group tick nham la nhung nguoi
 * chua co don an lai ngay. Nguoi DA co don thi den tu commission_entries nen khong phu thuoc co.
 */
test("listUsers: bo tick group thi an nguoi chua co don, GIU nguoi da co don", () => {
  const store = new LedgerStore(":memory:");
  try {
    tickedGroup(store, "group-1");
    store.upsertZaloKnownUser("group-1", "member-a");
    store.upsertZaloKnownUser("group-1", "member-b");
    recordOrder(store, "member-b", "order-1");

    store.setZaloGroupNotifySelection([]);

    const ids = store.listUsers().map((u) => u.userId);
    assert.ok(!ids.includes("member-a"), "nguoi chua co don an lai");
    assert.ok(ids.includes("member-b"), "nguoi da co don luon con");
  } finally {
    store.close();
  }
});

test("listUsers: user Telegram da co don van con trong danh sach", () => {
  const store = new LedgerStore(":memory:");
  try {
    tickedGroup(store, "group-1");
    store.upsertZaloKnownUser("group-1", "member-a");
    store.recordConversion({
      subId: "m-tele-a-abc-def",
      platform: "telegram",
      userId: "tele-a",
      merchant: "shopee",
      orderId: "order-tele",
      orderAmount: 500_000,
      commissionAmount: 100_000,
      taxPercent: 0,
      platformFeePercent: 0,
      userSharePercent: 80,
      maxCommissionRatioPercent: 1000,
      holdConfig: { thresholdVnd: 0, holdDays: 0 },
    });

    const row = store.listUsers().find((u) => u.userId === "tele-a");
    assert.equal(row?.platform, "telegram");
    assert.equal(row?.ordersCount, 1);
  } finally {
    store.close();
  }
});

test("listUsers: tra ve avatarUrl cua user Zalo da dong bo", () => {
  const store = new LedgerStore(":memory:");
  try {
    tickedGroup(store, "group-1");
    store.upsertUserProfile("zalo", "member-a", "Thao Nguyen", "https://s120-ava.zadn.vn/a.jpg");
    store.upsertZaloKnownUser("group-1", "member-a");

    assert.equal(
      store.listUsers().find((u) => u.userId === "member-a")?.avatarUrl,
      "https://s120-ava.zadn.vn/a.jpg"
    );
  } finally {
    store.close();
  }
});

/**
 * MOI tin nhan Zalo deu goi upsertUserProfile nhung event tin nhan KHONG mang avatar - ghi thang
 * la moi cau khach nhan se xoa sach avatar vua dong bo tu roster group.
 */
test("upsertUserProfile: avatar rong/thieu KHONG ghi de avatar da biet", () => {
  const store = new LedgerStore(":memory:");
  try {
    tickedGroup(store, "group-1");
    store.upsertZaloKnownUser("group-1", "member-a");
    store.upsertUserProfile("zalo", "member-a", "Thao", "https://s120-ava.zadn.vn/a.jpg");

    store.upsertUserProfile("zalo", "member-a", "Thao Nguyen");
    store.upsertUserProfile("zalo", "member-a", "Thao Nguyen", "");
    store.upsertUserProfile("zalo", "member-a", "Thao Nguyen", "   ");

    const row = store.listUsers().find((u) => u.userId === "member-a");
    assert.equal(row?.avatarUrl, "https://s120-ava.zadn.vn/a.jpg");
    assert.equal(row?.displayName, "Thao Nguyen", "ten van duoc cap nhat binh thuong");
  } finally {
    store.close();
  }
});

test("upsertUserProfile: avatar moi ghi de avatar cu (user doi anh)", () => {
  const store = new LedgerStore(":memory:");
  try {
    tickedGroup(store, "group-1");
    store.upsertZaloKnownUser("group-1", "member-a");
    store.upsertUserProfile("zalo", "member-a", "Thao", "https://s120-ava.zadn.vn/cu.jpg");
    store.upsertUserProfile("zalo", "member-a", "Thao", "https://s120-ava.zadn.vn/moi.jpg");

    assert.equal(
      store.listUsers().find((u) => u.userId === "member-a")?.avatarUrl,
      "https://s120-ava.zadn.vn/moi.jpg"
    );
  } finally {
    store.close();
  }
});

/**
 * Ten rong khong duoc ghi de ten da biet (quy tac co san tu truoc), nhung user chi biet qua roster
 * (chua tung nhan tin) thi khong co ho so nao ca - dong van phai hien ra voi ten null.
 */
test("listUsers: thanh vien chua tung nhan tin hien voi displayName null", () => {
  const store = new LedgerStore(":memory:");
  try {
    tickedGroup(store, "group-1");
    store.upsertZaloKnownUser("group-1", "member-im-lang");

    const row = store.listUsers().find((u) => u.userId === "member-im-lang");
    assert.ok(row);
    assert.equal(row.displayName, null);
    assert.equal(row.avatarUrl, null);
  } finally {
    store.close();
  }
});

/**
 * User roi group KHONG bi xoa (quyet dinh cua user 2026-10-09): ho van gui link qua DM cho bot duoc
 * nen van la user cua he thong. upsertZaloKnownUser vi vay chi cong don, khong co duong xoa nao.
 */
test("upsertZaloKnownUser: goi lai nhieu lan khong nhan ban dong", () => {
  const store = new LedgerStore(":memory:");
  try {
    tickedGroup(store, "group-1");
    store.upsertZaloKnownUser("group-1", "member-a");
    store.upsertZaloKnownUser("group-1", "member-a");
    store.upsertZaloKnownUser("group-1", "member-a");

    assert.equal(store.listUsers().filter((u) => u.userId === "member-a").length, 1);
  } finally {
    store.close();
  }
});
