import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDashboardPage } from "../dashboardHtml.js";
import type { CommissionEntry, WithdrawalRequest } from "../../core/types.js";

/**
 * Khoi "con thieu bao nhieu de rut tien" tren dashboard ca nhan (/d/:token).
 *
 * Bug that (2026-10-08, user bao cao kem anh chup): user co Kha dung 0d + Cho xac nhan 48.114d,
 * nguong rut 20.000d -> trang hien "Tich luy them 0d nua de du dieu kien rut tien". Nguyen nhan:
 * so con thieu tinh bang (nguong - CHO XAC NHAN) trong khi dieu kien mo form rut lai doc KHA DUNG
 * (commit 7c12ebb 2026-09-16 THAY availableBalance bang pendingConfirmationTotal thay vi CONG ca hai).
 *
 * Chot 3 trang thai loai tru nhau o day:
 *   available >= nguong                      -> form rut tien
 *   available < nguong <= available+pending  -> "dang cho Shopee duyet", KHONG phai "tich luy them"
 *   available + pending < nguong             -> "tich luy them <so con thieu that>"
 */

const THRESHOLD = 20_000;

function entry(overrides: Partial<CommissionEntry>): CommissionEntry {
  return {
    id: "e1",
    createdAt: "2026-10-07T01:56:43.000Z",
    orderDate: "2026-10-07",
    completedAt: null,
    availableFrom: null,
    platform: "zalo",
    userId: "u1",
    merchant: "shopee",
    subId: "k-u1-abc-xyz",
    orderId: "261006TQTHQXK2",
    productName: null,
    orderAmount: 562_500,
    commissionAmount: 67_500,
    taxAmount: 6_750,
    platformFeeAmount: 608,
    afterTaxAmount: 60_142,
    userShareAmount: 0,
    taxPercent: 10,
    platformFeePercent: 1,
    userSharePercent: 80,
    commissionOverriddenAt: null,
    status: "pending",
    withdrawalId: null,
    note: null,
    proofImagePath: null,
    ...overrides,
  };
}

function render(input: {
  availableBalance: number;
  entries: CommissionEntry[];
  heldBalance?: number;
  heldEntries?: CommissionEntry[];
  debtRemaining?: number;
  debts?: Array<{ orderId: string; remaining: number }>;
  pendingWithdrawal?: WithdrawalRequest | null;
  settledWithdrawal?: WithdrawalRequest | null;
}): string {
  return renderDashboardPage({
    entries: input.entries,
    availableBalance: input.availableBalance,
    heldBalance: input.heldBalance ?? 0,
    heldEntries: input.heldEntries ?? [],
    debtRemaining: input.debtRemaining ?? 0,
    debts:
      input.debts ??
      (input.debtRemaining ? [{ orderId: "OLD-ORDER", remaining: input.debtRemaining }] : []),
    pendingBalance: 0,
    paidTotal: 0,
    pendingWithdrawal: input.pendingWithdrawal ?? null,
    settledWithdrawal: input.settledWithdrawal ?? null,
    thresholdVnd: THRESHOLD,
    token: "tok",
    platform: "zalo",
    userId: "u1",
    displayName: "Yến Nhi",
  });
}

test("dashboard: khong bao gio noi 'tich luy them 0d' (bug 2026-10-08)", () => {
  // Dung so lieu that tu anh chup cua user: kha dung 0d, mot don pending 48.114d.
  const html = render({
    availableBalance: 0,
    entries: [entry({ userShareAmount: 48_114 })],
  });

  assert.ok(
    !/Tích luỹ thêm\s*0đ/.test(html),
    "cau 'tich luy them 0d nua' la vo nghia - user khong con phai tich luy gi ca"
  );
});

test("dashboard: du tien nhung con pending -> noi dang cho duyet, khong doi tich luy them", () => {
  const html = render({
    availableBalance: 0,
    entries: [entry({ userShareAmount: 48_114 })],
  });

  assert.ok(!html.includes("Tích luỹ thêm"), "khong duoc doi user tich luy them khi tien da du");
  assert.ok(html.includes("48.114đ"), "phai noi ro so tien dang cho Shopee xac nhan");
  assert.ok(html.includes("Khả dụng"), "phai noi ro tien chuyen sang Kha dung thi moi rut duoc");
});

test("dashboard: thieu that -> tru CA kha dung lan cho xac nhan", () => {
  // 5.000 kha dung + 3.000 cho xac nhan, nguong 20.000 -> con thieu 12.000.
  const html = render({
    availableBalance: 5_000,
    entries: [entry({ userShareAmount: 3_000 })],
  });

  assert.ok(html.includes("Tích luỹ thêm 12.000đ"), "so con thieu phai tru ca 2 nguon tien");
});

test("dashboard: chua co don nao -> con thieu dung bang nguong", () => {
  const html = render({ availableBalance: 0, entries: [] });

  assert.ok(html.includes("Tích luỹ thêm 20.000đ"));
});

test("dashboard: don da huy/da tra KHONG duoc tinh vao tien dang cho xac nhan", () => {
  const html = render({
    availableBalance: 0,
    entries: [
      entry({ id: "e1", status: "reversed", userShareAmount: 48_114 }),
      entry({ id: "e2", status: "paid", userShareAmount: 30_000 }),
    ],
  });

  assert.ok(html.includes("Tích luỹ thêm 20.000đ"), "chi don 'pending' moi la tien dang cho duyet");
});

test("dashboard: du kha dung -> van hien form rut tien nhu cu", () => {
  const html = render({
    availableBalance: 25_000,
    entries: [entry({ status: "confirmed", userShareAmount: 25_000 })],
  });

  assert.ok(html.includes("Yêu cầu rút 25.000đ"));
  assert.ok(!html.includes("Tích luỹ thêm"));
});

// ---------------------------------------------------------------------------
// Dong "Dang giu" va "Da tru hoan tra" (2026-10-08)
// ---------------------------------------------------------------------------

test("dashboard: khong co don bi giam / khong no -> KHONG hien 2 dong moi", () => {
  const html = render({ availableBalance: 50_000, entries: [entry({ status: "confirmed" })] });
  assert.doesNotMatch(html, /Đang tạm giữ/, 'hien "0d" cho user chua bao gio bi giam la tao lo lang vo ich');
  assert.doesNotMatch(html, /Đã trừ hoàn trả/);
});

test("dashboard: co don bi giam -> the 'Đang tạm giữ' hien SO TIEN, KHONG hien ngay", () => {
  const html = render({
    availableBalance: 0,
    entries: [entry({ orderId: "HELD-1", status: "confirmed", availableFrom: "2026-10-15" })],
    heldBalance: 150_000,
    heldEntries: [entry({ orderId: "HELD-1", status: "confirmed", availableFrom: "2026-10-15" })],
  });
  assert.match(html, /Đang tạm giữ/);
  assert.match(html, /150\.000/);

  // (2026-10-08, yeu cau truc tiep cua user) Ngay mo khoa KHONG con hien tren THE tong hop nua - chi
  // con dung 1 noi duy nhat: ngay duoi badge cua TUNG don (xem test ben duoi). Cat rieng doan HTML
  // cua the "Đang tạm giữ" (tu "Đang tạm giữ" den het </div> dau tien sau do) de chan dung vi tri,
  // tranh an nham vao ngay "15/10" dang nam o cho khac (vd order-card).
  const statCardStart = html.indexOf('<div class="label">Đang tạm giữ</div>');
  const statCardEnd = html.indexOf("</div></div>", statCardStart);
  const statCardHtml = html.slice(statCardStart, statCardEnd);
  assert.doesNotMatch(statCardHtml, /\d{2}\/\d{2}/, "the tong hop khong duoc chua ngay thang nao nua");
  // (2026-10-08, yeu cau truc tiep cua user) Khong con ca cau "xem ngay mo khoa o dau" - the nay chi
  // con dung LABEL + SO TIEN, khong co dong hint nao ca (truoc do co tung the mot cau tro toi, da
  // bi bo vi khong can thiet).
  assert.doesNotMatch(statCardHtml, /class="hint"/, "khong con dong hint nao duoi the nay");
});

// Day la vi tri DUY NHAT con hien ngay mo khoa: duoi badge "Đang tạm giữ" cua CHINH don do trong
// phan chi tiet tung don - khong con gop/liet ke o the tong hop nua (yeu cau truc tiep cua user).
test("dashboard: ngay mo khoa hien O TUNG DON, dung don dung ngay - khong bi lan voi don khac", () => {
  const html = render({
    availableBalance: 0,
    entries: [
      entry({ orderId: "ORDER-A", productName: "San pham A", status: "confirmed", availableFrom: "2026-10-12" }),
      entry({ orderId: "ORDER-B", productName: "San pham B", status: "confirmed", availableFrom: "2026-10-15" }),
    ],
    heldBalance: 300_000,
    heldEntries: [
      entry({ orderId: "ORDER-A", status: "confirmed", availableFrom: "2026-10-12" }),
      entry({ orderId: "ORDER-B", status: "confirmed", availableFrom: "2026-10-15" }),
    ],
  });

  const cards = html.split("order-card\">").slice(1); // bo phan truoc card dau tien
  const cardA = cards.find((c) => c.includes("ORDER-A"))!;
  const cardB = cards.find((c) => c.includes("ORDER-B"))!;

  assert.match(cardA, /mở khoá 12\/10/, "don A phai hien DUNG ngay cua no, khong phai cua don B");
  assert.doesNotMatch(cardA, /15\/10/);
  assert.match(cardB, /mở khoá 15\/10/, "don B phai hien DUNG ngay cua no, khong phai cua don A");
  assert.doesNotMatch(cardB, /12\/10/);
});

// Don KHONG bi giam (hoac da qua ngay mo khoa) thi badge la "Khả dụng" - khong duoc bia them dong
// "mo khoa" nao ca, du don do co san o UserLedgerSummary.heldEntries do mot loi logic nao khac.
test("dashboard: don KHONG dang bi giam -> khong co dong 'mo khoa' duoi badge cua no", () => {
  const html = render({
    availableBalance: 50_000,
    entries: [entry({ orderId: "FREE-1", status: "confirmed", availableFrom: null })],
  });
  const card = html.slice(html.indexOf('order-card">'));
  assert.doesNotMatch(card, /mở khoá/);
});

// (2026-10-08, feedback that cua user) No KHONG duoc la 1 the trong hang "tien ban co" - dat chung
// vao do thi user doc ra nhu mot loai so du nua. No la mot dong THONG BAO rieng ngay DUOI cac the.
function withdrawal(overrides: Partial<WithdrawalRequest>): WithdrawalRequest {
  return {
    id: "w1",
    createdAt: "2026-10-08T03:00:00.000Z",
    paidAt: null,
    platform: "zalo",
    userId: "u1",
    amount: 60_000,
    status: "requested",
    proofImagePath: null,
    bankName: "Vietcombank",
    bankAccountNumber: "0123456789",
    bankAccountHolder: "NGUYEN VAN A",
    debtApplied: 0,
    cancelledAt: null,
    cancelReason: null,
    ...overrides,
  };
}

// Mo hinh no 2026-10-08 (yeu cau truc tiep cua user): Kha dung va no TACH BACH - Kha dung khong tru
// no, no chi bi tru khi yeu cau rut duoc duyet.
test("dashboard: no KHONG phai 1 the trong hang so du, Kha dung KHONG ghi 'da tru'", () => {
  const html = render({
    availableBalance: 72_000,
    debtRemaining: 40_000,
    entries: [entry({ status: "confirmed" })],
  });
  const totals = html.slice(html.indexOf('<div class="totals">'), html.indexOf('class="notice"'));
  assert.doesNotMatch(totals, /trừ hoàn trả/i, "khong the no / chu thich 'da tru' nao trong hang the");
  assert.match(totals, /72\.000đ/, "Kha dung hien NGUYEN so, khong tru no");
});

test("dashboard: dong thong bao no dung NGUYEN VAN cau user yeu cau, nam DUOI cac the", () => {
  const html = render({
    availableBalance: 0,
    debtRemaining: 85_536,
    debts: [{ orderId: "C2-PAID", remaining: 85_536 }],
    entries: [entry({ status: "confirmed" })],
  });
  const posCards = html.indexOf('<div class="totals">');
  const posNotice = html.indexOf("đã được trả hàng");
  assert.ok(posNotice > posCards, "dong thong bao phai nam DUOI hang the");
  const text = html.replace(/<[^>]+>/g, "");
  assert.match(
    text,
    /Đơn C2-PAID đã được trả hàng sau khi bạn đã nhận tiền, nên Shopee thu lại hoa hồng của đơn đó\. Hiện bạn đang nợ 85\.536đ, số tiền này sẽ được Admin tự trừ khi bạn gửi yêu cầu Rút tiền lần sau/
  );
  assert.doesNotMatch(html, /trừ dần|tự hết dần|đã trừ khoản này/, "cau cua mo hinh CU");
});

test("dashboard: nhieu khoan no -> liet ke du cac don", () => {
  const html = render({
    availableBalance: 0,
    debtRemaining: 50_000,
    debts: [
      { orderId: "ORDER-A", remaining: 30_000 },
      { orderId: "ORDER-B", remaining: 20_000 },
    ],
    entries: [entry({ status: "confirmed" })],
  });
  assert.match(html, /2 đơn \(/);
  assert.match(html, /ORDER-A/);
  assert.match(html, /ORDER-B/);
  assert.match(html, /của những đơn đó/);
});

test("dashboard: khong no -> KHONG co dong thong bao nao", () => {
  const html = render({ availableBalance: 50_000, entries: [entry({ status: "confirmed" })] });
  assert.doesNotMatch(html, /đang nợ/);
});

// Quy tac (yeu cau truc tiep cua user 2026-10-08): Kha dung < no thi KHONG hien nut rut, cau goi y
// noi "Tich luy them (no - Kha dung)" va KHONG kem "(toi thieu 20.000d)".
test("Kha dung < no: KHONG hien form rut du Kha dung da qua nguong", () => {
  const html = render({
    availableBalance: 25_000,
    debtRemaining: 85_536,
    entries: [entry({ status: "confirmed" })],
  });
  assert.doesNotMatch(html, /<form[^>]*withdraw-form/);
  assert.match(html, /Tích luỹ thêm 60\.536đ nữa để đủ điều kiện rút tiền\./);
  assert.doesNotMatch(html, /tối thiểu/);
});

test("Khue 04: no 28.512d, Kha dung 0 -> tich luy them 28.512d, khong kem 'toi thieu'", () => {
  const html = render({ availableBalance: 0, debtRemaining: 28_512, entries: [entry({ status: "paid" })] });
  assert.match(html, /Tích luỹ thêm 28\.512đ nữa để đủ điều kiện rút tiền\./);
  assert.doesNotMatch(html, /tối thiểu/);
  assert.doesNotMatch(html, /<form[^>]*withdraw-form/);
});

test("Thu Ha: no 40.000d, Kha dung 8.554d -> tich luy them 31.446d", () => {
  const html = render({ availableBalance: 8_554, debtRemaining: 40_000, entries: [entry({ status: "confirmed" })] });
  assert.match(html, /Tích luỹ thêm 31\.446đ nữa để đủ điều kiện rút tiền\./);
  assert.doesNotMatch(html, /tối thiểu/);
});

test("Kha dung dung bang no -> hien form, khong bao gio noi 'them 0d'", () => {
  const html = render({ availableBalance: 28_512, debtRemaining: 28_512, entries: [entry({ status: "confirmed" })] });
  assert.match(html, /<form[^>]*withdraw-form/);
  assert.doesNotMatch(html, /Tích luỹ thêm/);
});

test("no NHO hon nguong: van bao theo nguong kem '(toi thieu ...)'", () => {
  const html = render({ availableBalance: 10_000, debtRemaining: 5_000, entries: [entry({ status: "confirmed" })] });
  assert.match(html, /Tích luỹ thêm 10\.000đ nữa để đủ điều kiện rút tiền \(tối thiểu 20\.000đ\)\./);
});

test("form rut case 1 (Kha dung > no): noi ro admin tru no va chuyen bao nhieu", () => {
  const html = render({
    availableBalance: 100_000,
    debtRemaining: 40_000,
    entries: [entry({ status: "confirmed" })],
  });
  const text = html.replace(/<[^>]+>/g, "");
  assert.match(text, /trừ 40\.000đ nợ và chuyển cho bạn 60\.000đ/);
  assert.equal(text.match(/đang nợ 40\.000đ/g)?.length, 1, "khong nhac so no 2 lan");
  assert.match(html, /Yêu cầu rút 100\.000đ/, "nut van ghi so user YEU CAU rut");
});

test("form rut khi Kha dung DUNG BANG no: noi ro tra het no, KHONG nhan tien chuyen khoan", () => {
  const html = render({
    availableBalance: 50_000,
    debtRemaining: 50_000,
    entries: [entry({ status: "confirmed" })],
  });
  const text = html.replace(/<[^>]+>/g, "");
  assert.match(text, /trả hết nợ/);
  assert.match(text, /không nhận tiền chuyển khoản/);
});

test("yeu cau rut dang cho co tru no -> hien W, so no se tru va so se chuyen; khong nhac no 2 lan", () => {
  const html = render({
    availableBalance: 0,
    debtRemaining: 40_000,
    debts: [{ orderId: "C-PAID", remaining: 40_000 }],
    pendingWithdrawal: withdrawal({ amount: 60_000, debtApplied: 40_000 }),
    entries: [entry({ status: "confirmed" })],
  });
  const text = html.replace(/<[^>]+>/g, "");
  assert.match(text, /Yêu cầu rút 100\.000đ đang chờ xử lý/);
  assert.match(text, /trừ 40\.000đ nợ hoàn trả và chuyển cho bạn 60\.000đ/);
  assert.doesNotMatch(text, /sẽ được Admin tự trừ khi bạn gửi yêu cầu Rút tiền lần sau/, "no da nam trong yeu cau dang cho");
});

test("vua tu dong tru no -> trang noi ro khong co tien chuyen khoan", () => {
  const html = render({
    availableBalance: 0,
    debtRemaining: 20_000,
    debts: [{ orderId: "C-PAID", remaining: 20_000 }],
    settledWithdrawal: withdrawal({ amount: 0, debtApplied: 30_000, status: "paid" }),
    entries: [entry({ status: "paid" })],
  });
  const text = html.replace(/<[^>]+>/g, "");
  assert.match(text, /Đã dùng 30\.000đ số dư khả dụng để trừ nợ hoàn trả/);
  assert.match(text, /Hiện bạn đang nợ 20\.000đ/);
});

// BUG THAT thu HAI cung kieu (2026-10-08, phat hien khi xem trang that): tien DANG GIU la tien user
// DA CO, chi chua toi ngay mo khoa - nhung khong nam trong availableBalance lan pendingConfirmation,
// nen cong thuc cu noi "Tich luy them 11.744d nua" voi mot nguoi dang co 213.840d bi giam.
test("co don bi giam du nguong -> KHONG bao 'tich luy them', ma bao cho toi ngay mo khoa", () => {
  const html = render({
    availableBalance: 8_256,
    heldBalance: 213_840,
    heldEntries: [entry({ status: "confirmed", availableFrom: "2026-10-15" })],
    entries: [entry({ status: "confirmed", availableFrom: "2026-10-15" })],
  });
  assert.doesNotMatch(html, /Tích luỹ thêm/, "ho khong con phai mua them gi ca");
  assert.match(html, /được giữ thêm vài ngày/);
  assert.match(html, /15\/10/);
  assert.match(html, /không cần mua thêm gì/);
});

test("so con thieu TRU CA tien dang giam, khong noi thua", () => {
  // nguong 20.000; co 1.000 kha dung + 2.000 dang giam -> con thieu 17.000 (khong phai 19.000)
  const html = render({
    availableBalance: 1_000,
    heldBalance: 2_000,
    heldEntries: [entry({ status: "confirmed", availableFrom: "2026-10-15" })],
    entries: [entry({ status: "confirmed", availableFrom: "2026-10-15" })],
  });
  assert.match(html, /Tích luỹ thêm 17\.000/);
});

// Khong no (debtRemaining=0): cong thuc moi phai TRUNG het voi hanh vi cu, khong
// duoc lam vo cac case KHONG co no da dung tu truoc.
test("khong no: cong thuc moi khong lam doi hanh vi cac case cu", () => {
  const html = render({
    availableBalance: 15_000,
    entries: [entry({ status: "pending", userShareAmount: 3_000 })],
  });
  assert.match(html, /Tích luỹ thêm 2\.000đ/); // 20.000 - 15.000 - 3.000
});
