import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDashboardPage } from "../dashboardHtml.js";
import type { CommissionEntry } from "../../core/types.js";

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
  grossAvailableBalance?: number;
  heldBalance?: number;
  heldEntries?: CommissionEntry[];
  debtRemaining?: number;
  debts?: Array<{ orderId: string; remaining: number }>;
}): string {
  return renderDashboardPage({
    entries: input.entries,
    availableBalance: input.availableBalance,
    grossAvailableBalance: input.grossAvailableBalance ?? input.availableBalance,
    heldBalance: input.heldBalance ?? 0,
    heldEntries: input.heldEntries ?? [],
    debtRemaining: input.debtRemaining ?? 0,
    debts:
      input.debts ??
      (input.debtRemaining ? [{ orderId: "OLD-ORDER", remaining: input.debtRemaining }] : []),
    pendingBalance: 0,
    paidTotal: 0,
    pendingWithdrawal: null,
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

test("dashboard: co don bi giam -> hien 'Dang tam giu' + ngay mo khoa cua don do", () => {
  const html = render({
    availableBalance: 0,
    entries: [entry({ status: "confirmed", availableFrom: "2026-10-15" })],
    heldBalance: 150_000,
    heldEntries: [entry({ status: "confirmed", availableFrom: "2026-10-15" })],
  });
  assert.match(html, /Đang tạm giữ/);
  assert.match(html, /150\.000/);
  assert.match(html, /mở khoá 15\/10/);
});

test("dashboard: nhieu don bi giam ngay khac nhau -> liet ke TUNG ngay, khong gop", () => {
  const html = render({
    availableBalance: 0,
    entries: [],
    heldBalance: 300_000,
    heldEntries: [
      entry({ status: "confirmed", availableFrom: "2026-10-12" }),
      entry({ status: "confirmed", availableFrom: "2026-10-15" }),
    ],
  });
  assert.match(html, /12\/10/);
  assert.match(html, /15\/10/);
});

// (2026-10-08, feedback that cua user) No KHONG duoc la 1 the trong hang "tien ban co" - dat chung
// vao do thi user doc ra nhu mot loai so du nua. No la mot dong THONG BAO rieng ngay DUOI cac the.
test("dashboard: no KHONG phai 1 the trong hang so du", () => {
  const html = render({
    availableBalance: 32_000,
    grossAvailableBalance: 72_000,
    debtRemaining: 40_000,
    entries: [entry({ status: "confirmed" })],
  });
  const totals = html.slice(html.indexOf('<div class="totals">'), html.indexOf("</div>\n${") + 1);
  assert.doesNotMatch(
    html.slice(html.indexOf('<div class="totals">'), html.indexOf('class="notice"')),
    /Đã trừ hoàn trả/,
    "khong duoc co the no nao trong hang the"
  );
  assert.ok(totals !== null);
});

test("dashboard: dong thong bao no nam DUOI cac the va giai thich du y", () => {
  const html = render({
    availableBalance: 32_000,
    grossAvailableBalance: 72_000,
    debtRemaining: 40_000,
    debts: [{ orderId: "260925VX0R3SQ9", remaining: 40_000 }],
    entries: [entry({ status: "confirmed" })],
  });

  const posCards = html.indexOf('<div class="totals">');
  const posNotice = html.indexOf("đang được trừ lại");
  assert.ok(posNotice > posCards, "dong thong bao phai nam DUOI hang the");

  assert.match(html, /40\.000đ đang được trừ lại/, "noi ro so tien");
  assert.match(html, /260925VX0R3SQ9/, "noi ro DON NAO de user doi chieu duoc");
  assert.match(html, /đã được trả hàng/, "noi ro VI SAO");
  assert.match(html, /không phải chuyển tiền lại/, "y quan trong nhat - thieu la user tuong phai tra tien ra");
  assert.match(html, /tự hết dần khi bạn có đơn mới/, "noi ro khoan nay se het the nao");
  assert.match(html, /đã trừ hoàn trả/, "the Kha dung van phai noi ro la so DA tru");
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
  assert.match(html, /2 đơn đã được trả hàng/);
  assert.match(html, /ORDER-A/);
  assert.match(html, /ORDER-B/);
});

test("dashboard: khong no -> KHONG co dong thong bao nao", () => {
  const html = render({ availableBalance: 50_000, entries: [entry({ status: "confirmed" })] });
  assert.doesNotMatch(html, /đang được trừ lại/);
});

test("form rut hien so bi tru TRUOC KHI user bam gui", () => {
  const html = render({
    availableBalance: 60_000,
    grossAvailableBalance: 100_000,
    debtRemaining: 40_000,
    entries: [entry({ status: "confirmed" })],
  });
  assert.match(html, /100\.000/, "so du goc");
  assert.match(html, /40\.000/, "so bi tru");
  assert.match(html, /bạn sẽ nhận/);
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
