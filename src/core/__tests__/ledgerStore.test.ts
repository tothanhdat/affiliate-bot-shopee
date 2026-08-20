import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../ledgerStore.js";
import {
  DuplicateConversionError,
  EntryAlreadyWithdrawnError,
  EntryNotPendingError,
  ImplausibleCommissionAmountError,
  InsufficientBalanceError,
  InvalidPaymentAmountError,
  MissingBankInfoError,
  MissingWithdrawalProofError,
  WithdrawalAlreadyPendingError,
} from "../errors.js";

const BANK_INFO = { bankName: "Vietcombank", bankAccountNumber: "0123456789", bankAccountHolder: "Nguyen Van A" };

// taxPercent/platformFeePercent mac dinh 0 trong helper nay de cac test co san (viet truoc khi co
// buoc tru thue/phi) khong phai tinh lai so - test rieng ve thue/phi o duoi dung gia tri khac 0.
function recordSample(
  store: LedgerStore,
  overrides: Partial<{ orderId: string; commissionAmount: number; userId: string }> = {}
) {
  return store.recordConversion({
    subId: "telegram-user-a-abc123-def",
    platform: "telegram",
    userId: overrides.userId ?? "user-a",
    merchant: "shopee",
    orderId: overrides.orderId ?? "order-1",
    orderAmount: 500_000,
    commissionAmount: overrides.commissionAmount ?? 100_000,
    taxPercent: 0,
    platformFeePercent: 0,
    userSharePercent: 80,
    maxCommissionRatioPercent: 1000,
  });
}

test("LedgerStore: recordConversion tinh dung userShareAmount theo ty le", () => {
  const store = new LedgerStore(":memory:");
  try {
    const entry = recordSample(store, { commissionAmount: 100_000 });
    assert.equal(entry.userShareAmount, 80_000);
    assert.equal(entry.status, "confirmed");
    assert.equal(entry.withdrawalId, null);
  } finally {
    store.close();
  }
});

test("LedgerStore: recordConversion lam tron so le VND", () => {
  const store = new LedgerStore(":memory:");
  try {
    const entry = store.recordConversion({
      subId: "telegram-user-a-abc123-def",
      platform: "telegram",
      userId: "user-a",
      merchant: "shopee",
      orderId: "order-odd",
      orderAmount: 33_333,
      commissionAmount: 33_333,
      taxPercent: 0,
      platformFeePercent: 0,
      userSharePercent: 80,
      maxCommissionRatioPercent: 1000,
    });
    assert.equal(entry.userShareAmount, Math.round((33_333 * 80) / 100));
  } finally {
    store.close();
  }
});

test("LedgerStore: recordConversion tru thue truoc, phi san tren phan da tru thue, roi moi chia % cho user", () => {
  const store = new LedgerStore(":memory:");
  try {
    // Doi chieu voi vi du quan sat tu 1 bot doi thu: hoa hong goc 7.584d, thue 10%, phi san 1%
    // tren phan da tru thue, user nhan 90% phan con lai -> ra dung 6.082d nhu bot do hien thi.
    const entry = store.recordConversion({
      subId: "telegram-user-a-abc123-def",
      platform: "telegram",
      userId: "user-a",
      merchant: "shopee",
      orderId: "order-tax",
      orderAmount: 238_000,
      commissionAmount: 7_584,
      taxPercent: 10,
      platformFeePercent: 1,
      userSharePercent: 90,
      maxCommissionRatioPercent: 1000,
    });

    assert.equal(entry.taxAmount, 758); // round(7584 * 10%)
    assert.equal(entry.platformFeeAmount, 68); // round((7584-758) * 1%)
    assert.equal(entry.afterTaxAmount, 6_758); // 7584 - 758 - 68
    assert.equal(entry.userShareAmount, 6_082); // round(6758 * 90%) - khop voi vi du quan sat duoc
  } finally {
    store.close();
  }
});

test("LedgerStore: recordConversion nem ImplausibleCommissionAmountError khi vuot nguong ty le, khong ghi entry", () => {
  const store = new LedgerStore(":memory:");
  try {
    assert.throws(
      () =>
        store.recordConversion({
          subId: "telegram-user-a-abc123-def",
          platform: "telegram",
          userId: "user-a",
          merchant: "shopee",
          orderId: "order-typo",
          orderAmount: 50_000,
          commissionAmount: 500_000, // go nham them 1 so 0 - vuot xa 50% cua orderAmount
          taxPercent: 0,
          platformFeePercent: 0,
          userSharePercent: 80,
          maxCommissionRatioPercent: 50,
        }),
      ImplausibleCommissionAmountError
    );
    assert.equal(store.getAvailableBalance("telegram", "user-a"), 0);
  } finally {
    store.close();
  }
});

test("LedgerStore: recordConversion cho qua khi commissionAmount trong nguong ty le hop le", () => {
  const store = new LedgerStore(":memory:");
  try {
    const entry = store.recordConversion({
      subId: "telegram-user-a-abc123-def",
      platform: "telegram",
      userId: "user-a",
      merchant: "shopee",
      orderId: "order-1",
      orderAmount: 500_000,
      commissionAmount: 100_000, // 20%, duoi nguong 50%
      taxPercent: 0,
      platformFeePercent: 0,
      userSharePercent: 80,
      maxCommissionRatioPercent: 50,
    });
    assert.equal(entry.commissionAmount, 100_000);
  } finally {
    store.close();
  }
});

test("LedgerStore: ghi trung (merchant, orderId) nem DuplicateConversionError", () => {
  const store = new LedgerStore(":memory:");
  try {
    recordSample(store, { orderId: "order-dup" });
    assert.throws(() => recordSample(store, { orderId: "order-dup" }), DuplicateConversionError);
  } finally {
    store.close();
  }
});

test("LedgerStore: recordConversion voi status='pending' khong tinh vao so du kha dung", () => {
  const store = new LedgerStore(":memory:");
  try {
    store.recordConversion({
      subId: "telegram-user-a-abc123-def",
      platform: "telegram",
      userId: "user-a",
      merchant: "shopee",
      orderId: "order-pending",
      orderAmount: 500_000,
      commissionAmount: 100_000,
      taxPercent: 0,
      platformFeePercent: 0,
      userSharePercent: 80,
      maxCommissionRatioPercent: 1000,
      status: "pending",
    });
    assert.equal(store.getAvailableBalance("telegram", "user-a"), 0);
    const entries = store.getUserSummary("telegram", "user-a").entries;
    assert.equal(entries.length, 1);
    assert.equal(entries[0].status, "pending");
  } finally {
    store.close();
  }
});

test("LedgerStore: confirmPendingEntry chuyen entry tu pending sang confirmed, tinh lai so tien tu du lieu moi", () => {
  const store = new LedgerStore(":memory:");
  try {
    const pending = store.recordConversion({
      subId: "telegram-user-a-abc123-def",
      platform: "telegram",
      userId: "user-a",
      merchant: "shopee",
      orderId: "order-promote",
      orderAmount: 100_000,
      commissionAmount: 8_000, // uoc tinh luc con hold
      taxPercent: 0,
      platformFeePercent: 0,
      userSharePercent: 80,
      maxCommissionRatioPercent: 1000,
      status: "pending",
    });
    assert.equal(store.getAvailableBalance("telegram", "user-a"), 0);

    const confirmed = store.confirmPendingEntry(pending.id, {
      orderAmount: 100_000,
      commissionAmount: 10_000, // so that luc duyet - khac so uoc tinh luc hold
      taxPercent: 0,
      platformFeePercent: 0,
      userSharePercent: 80,
      maxCommissionRatioPercent: 1000,
    });

    assert.equal(confirmed.id, pending.id); // UPDATE tai cho, khong tao id moi
    assert.equal(confirmed.status, "confirmed");
    assert.equal(confirmed.commissionAmount, 10_000);
    assert.equal(confirmed.userShareAmount, 8_000); // 80% cua 10_000
    assert.equal(store.getAvailableBalance("telegram", "user-a"), 8_000);

    const entries = store.getUserSummary("telegram", "user-a").entries;
    assert.equal(entries.length, 1); // khong tao entry trung
  } finally {
    store.close();
  }
});

test("LedgerStore: getAvailableBalance cong dung nhieu entry cua 1 user, khong lan sang user khac", () => {
  const store = new LedgerStore(":memory:");
  try {
    recordSample(store, { orderId: "order-1", commissionAmount: 100_000, userId: "user-a" });
    recordSample(store, { orderId: "order-2", commissionAmount: 50_000, userId: "user-a" });
    recordSample(store, { orderId: "order-3", commissionAmount: 999_000, userId: "user-b" });

    assert.equal(store.getAvailableBalance("telegram", "user-a"), 80_000 + 40_000);
    assert.equal(store.getAvailableBalance("telegram", "user-b"), Math.round((999_000 * 80) / 100));
  } finally {
    store.close();
  }
});

test("LedgerStore: findOrCreateDashboardToken idempotent theo platform+userId", () => {
  const store = new LedgerStore(":memory:");
  try {
    const first = store.findOrCreateDashboardToken("telegram", "user-a");
    const second = store.findOrCreateDashboardToken("telegram", "user-a");
    assert.equal(first.token, second.token);

    const other = store.findOrCreateDashboardToken("zalo", "user-a");
    assert.notEqual(other.token, first.token);
  } finally {
    store.close();
  }
});

test("LedgerStore: getUserByToken tra ve null voi token khong ton tai", () => {
  const store = new LedgerStore(":memory:");
  try {
    assert.equal(store.getUserByToken("khong-ton-tai"), null);
  } finally {
    store.close();
  }
});

test("LedgerStore: getUserByToken tra dung platform/userId cho token hop le", () => {
  const store = new LedgerStore(":memory:");
  try {
    const { token } = store.findOrCreateDashboardToken("telegram", "user-a");
    assert.deepEqual(store.getUserByToken(token), { platform: "telegram", userId: "user-a" });
  } finally {
    store.close();
  }
});

test("LedgerStore: requestWithdrawal nem InsufficientBalanceError khi duoi nguong", () => {
  const store = new LedgerStore(":memory:");
  try {
    recordSample(store, { commissionAmount: 10_000 }); // userShare = 8_000
    assert.throws(
      () => store.requestWithdrawal("telegram", "user-a", 50_000, BANK_INFO),
      InsufficientBalanceError
    );
  } finally {
    store.close();
  }
});

test("LedgerStore: requestWithdrawal nem MissingBankInfoError khi thieu bat ky truong ngan hang nao", () => {
  const store = new LedgerStore(":memory:");
  try {
    recordSample(store, { commissionAmount: 100_000 });
    assert.throws(
      () => store.requestWithdrawal("telegram", "user-a", 50_000, { ...BANK_INFO, bankAccountNumber: "  " }),
      MissingBankInfoError
    );
    assert.throws(
      () => store.requestWithdrawal("telegram", "user-a", 50_000, { ...BANK_INFO, bankName: "" }),
      MissingBankInfoError
    );
  } finally {
    store.close();
  }
});

test("LedgerStore: requestWithdrawal luu dung thong tin ngan hang", () => {
  const store = new LedgerStore(":memory:");
  try {
    recordSample(store, { commissionAmount: 100_000 });
    const withdrawal = store.requestWithdrawal("telegram", "user-a", 50_000, BANK_INFO);
    assert.equal(withdrawal.bankName, BANK_INFO.bankName);
    assert.equal(withdrawal.bankAccountNumber, BANK_INFO.bankAccountNumber);
    assert.equal(withdrawal.bankAccountHolder, BANK_INFO.bankAccountHolder);

    const pending = store.getPendingWithdrawal("telegram", "user-a");
    assert.equal(pending?.bankAccountHolder, BANK_INFO.bankAccountHolder);
  } finally {
    store.close();
  }
});

test("LedgerStore: requestWithdrawal thanh cong va khoa cac entry lien quan - goi lan 2 nem WithdrawalAlreadyPendingError", () => {
  const store = new LedgerStore(":memory:");
  try {
    recordSample(store, { orderId: "order-1", commissionAmount: 100_000 }); // userShare = 80_000

    const withdrawal = store.requestWithdrawal("telegram", "user-a", 50_000, BANK_INFO);
    assert.equal(withdrawal.amount, 80_000);
    assert.equal(withdrawal.status, "requested");

    // So du kha dung phai ve 0 vi entry da bi khoa boi withdrawal vua tao
    assert.equal(store.getAvailableBalance("telegram", "user-a"), 0);

    assert.throws(
      () => store.requestWithdrawal("telegram", "user-a", 50_000, BANK_INFO),
      WithdrawalAlreadyPendingError
    );
  } finally {
    store.close();
  }
});

test("LedgerStore: markWithdrawalPaid chuyen dung trang thai withdrawal va cac entry lien quan", () => {
  const store = new LedgerStore(":memory:");
  try {
    recordSample(store, { orderId: "order-1", commissionAmount: 100_000 });
    const withdrawal = store.requestWithdrawal("telegram", "user-a", 50_000, BANK_INFO);

    const paid = store.markWithdrawalPaid(withdrawal.id, "proof-1.png");
    assert.equal(paid.status, "paid");
    assert.notEqual(paid.paidAt, null);
    assert.equal(paid.proofImagePath, "proof-1.png");

    const summary = store.getUserSummary("telegram", "user-a");
    assert.equal(summary.paidTotal, 80_000);
    assert.equal(summary.availableBalance, 0);
    assert.equal(summary.pendingBalance, 0);
    assert.equal(store.getPendingWithdrawal("telegram", "user-a"), null);
  } finally {
    store.close();
  }
});

test("LedgerStore: reverseCommissionEntry huy dung don dang 'pending'", () => {
  const store = new LedgerStore(":memory:");
  try {
    const entry = store.recordConversion({
      subId: "telegram-user-a-abc123-def",
      platform: "telegram",
      userId: "user-a",
      merchant: "shopee",
      orderId: "order-pending-1",
      orderAmount: 500_000,
      commissionAmount: 100_000,
      taxPercent: 0,
      platformFeePercent: 0,
      userSharePercent: 80,
      maxCommissionRatioPercent: 1000,
      status: "pending",
    });

    const reversed = store.reverseCommissionEntry(entry.id, "khong dat doi soat");
    assert.equal(reversed.status, "reversed");
    assert.match(reversed.note ?? "", /khong dat doi soat/);
    assert.equal(store.getAvailableBalance("telegram", "user-a"), 0);
  } finally {
    store.close();
  }
});

// 2026-08-20 (quyet dinh chot lai voi user, dua theo FAQ Accesstrade: "hoa hong duoc duyet" la so
// lieu cuoi cung dung de thanh toan) - don "confirmed" (Kha dung) duoc xem la da hoan tat, KHONG
// con huy duoc qua reverseCommissionEntry nua, du chua gan vao yeu cau rut tien nao.
test("LedgerStore: reverseCommissionEntry nem EntryNotPendingError khi entry da 'confirmed' (Kha dung)", () => {
  const store = new LedgerStore(":memory:");
  try {
    const entry = recordSample(store, { orderId: "order-1", commissionAmount: 100_000 });
    assert.equal(entry.status, "confirmed");
    assert.throws(() => store.reverseCommissionEntry(entry.id, "khach hoan hang"), EntryNotPendingError);
    assert.equal(store.getAvailableBalance("telegram", "user-a"), 80_000); // khong bi anh huong
  } finally {
    store.close();
  }
});

test("LedgerStore: reverseCommissionEntry nem EntryNotPendingError khi entry dang cho rut (chua paid)", () => {
  const store = new LedgerStore(":memory:");
  try {
    const entry = recordSample(store, { orderId: "order-1", commissionAmount: 100_000 });
    store.requestWithdrawal("telegram", "user-a", 50_000, BANK_INFO); // gan withdrawal_id cho entry nay

    assert.throws(() => store.reverseCommissionEntry(entry.id, "khach hoan hang"), EntryNotPendingError);
  } finally {
    store.close();
  }
});

test("LedgerStore: reverseCommissionEntry nem EntryNotPendingError khi entry da paid", () => {
  const store = new LedgerStore(":memory:");
  try {
    const entry = recordSample(store, { orderId: "order-1", commissionAmount: 100_000 });
    const withdrawal = store.requestWithdrawal("telegram", "user-a", 50_000, BANK_INFO);
    store.markWithdrawalPaid(withdrawal.id, "proof-1.png");

    assert.throws(() => store.reverseCommissionEntry(entry.id, "khach hoan hang"), EntryNotPendingError);
  } finally {
    store.close();
  }
});

// 2026-08-20: loi thoat rieng cho CLI reverse-entry - Shopee ghi tay khong co giai doan "pending"
// nen day la cach duy nhat sua loi nhap sai/xu ly tra hang phat hien tre cho merchant nay.
test("LedgerStore: reverseCommissionEntry voi allowNonPending=true huy duoc entry 'confirmed' chua gan withdrawal", () => {
  const store = new LedgerStore(":memory:");
  try {
    const entry = recordSample(store, { orderId: "order-1", commissionAmount: 100_000 });
    assert.equal(entry.status, "confirmed");

    const reversed = store.reverseCommissionEntry(entry.id, "nhap sai gia don", { allowNonPending: true });
    assert.equal(reversed.status, "reversed");
    assert.equal(store.getAvailableBalance("telegram", "user-a"), 0);
  } finally {
    store.close();
  }
});

test("LedgerStore: reverseCommissionEntry voi allowNonPending=true VAN nem EntryAlreadyWithdrawnError neu da gan vao yeu cau rut tien", () => {
  const store = new LedgerStore(":memory:");
  try {
    const entry = recordSample(store, { orderId: "order-1", commissionAmount: 100_000 });
    store.requestWithdrawal("telegram", "user-a", 50_000, BANK_INFO);

    assert.throws(
      () => store.reverseCommissionEntry(entry.id, "nhap sai gia don", { allowNonPending: true }),
      EntryAlreadyWithdrawnError
    );
  } finally {
    store.close();
  }
});

test("LedgerStore: listPendingWithdrawals chi tra ve cac yeu cau dang cho", () => {
  const store = new LedgerStore(":memory:");
  try {
    recordSample(store, { orderId: "order-1", commissionAmount: 100_000, userId: "user-a" });
    recordSample(store, { orderId: "order-2", commissionAmount: 100_000, userId: "user-b" });

    const w1 = store.requestWithdrawal("telegram", "user-a", 50_000, BANK_INFO);
    store.requestWithdrawal("telegram", "user-b", 50_000, BANK_INFO);
    store.markWithdrawalPaid(w1.id, "proof-1.png");

    const pending = store.listPendingWithdrawals();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].userId, "user-b");
  } finally {
    store.close();
  }
});

test("LedgerStore: getUserSummary tra ve proofImagePath cho entry paid, null cho entry chua rut/khac withdrawal", () => {
  const store = new LedgerStore(":memory:");
  try {
    const entry1 = recordSample(store, { orderId: "order-1", commissionAmount: 100_000, userId: "user-a" });
    const withdrawal = store.requestWithdrawal("telegram", "user-a", 50_000, BANK_INFO);
    store.markWithdrawalPaid(withdrawal.id, "proof-a.png");

    const entry2 = recordSample(store, { orderId: "order-2", commissionAmount: 100_000, userId: "user-a" });

    const summary = store.getUserSummary("telegram", "user-a");
    const paidEntry = summary.entries.find((e) => e.id === entry1.id);
    const stillAvailableEntry = summary.entries.find((e) => e.id === entry2.id);
    assert.equal(paidEntry?.status, "paid");
    assert.equal(paidEntry?.proofImagePath, "proof-a.png");
    assert.equal(stillAvailableEntry?.status, "confirmed");
    assert.equal(stillAvailableEntry?.proofImagePath, null);
  } finally {
    store.close();
  }
});

test("LedgerStore: markWithdrawalPaid nem MissingWithdrawalProofError neu thieu proofImagePath", () => {
  const store = new LedgerStore(":memory:");
  try {
    recordSample(store, { orderId: "order-1", commissionAmount: 100_000 });
    const withdrawal = store.requestWithdrawal("telegram", "user-a", 50_000, BANK_INFO);

    assert.throws(() => store.markWithdrawalPaid(withdrawal.id, ""), MissingWithdrawalProofError);
    assert.throws(() => store.markWithdrawalPaid(withdrawal.id, "   "), MissingWithdrawalProofError);
    assert.equal(store.getPendingWithdrawal("telegram", "user-a")?.status, "requested");
  } finally {
    store.close();
  }
});

test("LedgerStore: listPaidWithdrawals tra ve theo thu tu moi nhat truoc, kem proofImagePath", () => {
  const store = new LedgerStore(":memory:");
  try {
    recordSample(store, { orderId: "order-1", commissionAmount: 100_000, userId: "user-a" });
    recordSample(store, { orderId: "order-2", commissionAmount: 100_000, userId: "user-b" });

    const w1 = store.requestWithdrawal("telegram", "user-a", 50_000, BANK_INFO);
    const w2 = store.requestWithdrawal("telegram", "user-b", 50_000, BANK_INFO);
    store.markWithdrawalPaid(w1.id, "proof-a.png");
    store.markWithdrawalPaid(w2.id, "proof-b.png");

    const paid = store.listPaidWithdrawals();
    assert.equal(paid.length, 2);
    assert.equal(paid[0].id, w2.id);
    assert.equal(paid[0].proofImagePath, "proof-b.png");
    assert.equal(paid[1].proofImagePath, "proof-a.png");
  } finally {
    store.close();
  }
});

test("LedgerStore: upsertUserProfile ghi/cap nhat ten, bo qua chuoi rong", () => {
  const store = new LedgerStore(":memory:");
  try {
    store.upsertUserProfile("telegram", "user-a", "Nguyễn Văn A");
    assert.equal(store.getDisplayNamesMap().get("telegram:user-a"), "Nguyễn Văn A");

    store.upsertUserProfile("telegram", "user-a", "Nguyễn Văn A (đổi tên)");
    assert.equal(store.getDisplayNamesMap().get("telegram:user-a"), "Nguyễn Văn A (đổi tên)");

    store.upsertUserProfile("telegram", "user-a", "   ");
    assert.equal(store.getDisplayNamesMap().get("telegram:user-a"), "Nguyễn Văn A (đổi tên)");

    assert.equal(store.getDisplayNamesMap().get("telegram:user-khong-ton-tai"), undefined);
  } finally {
    store.close();
  }
});

test("LedgerStore: tryClaimWelcomeMessage chi tra true lan dau, false tu lan 2, doc lap theo platform/user", () => {
  const store = new LedgerStore(":memory:");
  try {
    assert.equal(store.tryClaimWelcomeMessage("zalo", "user-a"), true);
    assert.equal(store.tryClaimWelcomeMessage("zalo", "user-a"), false);
    assert.equal(store.tryClaimWelcomeMessage("zalo", "user-a"), false);

    // User khac hoac platform khac khong bi anh huong boi user-a da claim.
    assert.equal(store.tryClaimWelcomeMessage("zalo", "user-b"), true);
    assert.equal(store.tryClaimWelcomeMessage("telegram", "user-a"), true);
  } finally {
    store.close();
  }
});

test("LedgerStore: listUsers tra ve dung displayName tu user_profiles", () => {
  const store = new LedgerStore(":memory:");
  try {
    recordSample(store, { userId: "user-a" });
    store.upsertUserProfile("telegram", "user-a", "Nguyễn Văn A");

    const [user] = store.listUsers();
    assert.equal(user.userId, "user-a");
    assert.equal(user.displayName, "Nguyễn Văn A");
  } finally {
    store.close();
  }
});

test("LedgerStore: recordAccesstradePayment nem InvalidPaymentAmountError voi so tien <= 0", () => {
  const store = new LedgerStore(":memory:");
  try {
    assert.throws(() => store.recordAccesstradePayment({ amountVnd: 0 }), InvalidPaymentAmountError);
    assert.throws(() => store.recordAccesstradePayment({ amountVnd: -1000 }), InvalidPaymentAmountError);
  } finally {
    store.close();
  }
});

test("LedgerStore: getReconciliationSummary tra ve 0 het khi chua co du lieu, cong dung nhieu lan ghi nhan", () => {
  const store = new LedgerStore(":memory:");
  try {
    const empty = store.getReconciliationSummary();
    assert.deepEqual(empty, { totalReceivedVnd: 0, totalPaidToUsersVnd: 0, remainingVnd: 0 });

    store.recordAccesstradePayment({ amountVnd: 2_000_000, note: "ky thang 8" });
    store.recordAccesstradePayment({ amountVnd: 1_000_000 });

    const summary = store.getReconciliationSummary();
    assert.equal(summary.totalReceivedVnd, 3_000_000);
    assert.equal(summary.remainingVnd, 3_000_000);
  } finally {
    store.close();
  }
});

test("LedgerStore: getReconciliationSummary - da tra chi tinh withdrawal status paid, canh bao khi am", () => {
  const store = new LedgerStore(":memory:");
  try {
    store.recordAccesstradePayment({ amountVnd: 1_000_000 });

    recordSample(store, { orderId: "order-1", commissionAmount: 1_500_000 });
    const withdrawal = store.requestWithdrawal("telegram", "user-a", 50_000, BANK_INFO);

    // Dang cho, chua "paid" -> khong tinh vao da tra.
    let summary = store.getReconciliationSummary();
    assert.equal(summary.totalReceivedVnd, 1_000_000);
    assert.equal(summary.totalPaidToUsersVnd, 0);
    assert.equal(summary.remainingVnd, 1_000_000);

    store.markWithdrawalPaid(withdrawal.id, "proof-1.png");
    summary = store.getReconciliationSummary();
    assert.equal(summary.totalPaidToUsersVnd, withdrawal.amount);
    assert.equal(summary.remainingVnd, 1_000_000 - withdrawal.amount);
    assert.ok(summary.remainingVnd < 0, "vi du nay co chu dich de tao so am, kiem tra canh bao dung huong");
  } finally {
    store.close();
  }
});
