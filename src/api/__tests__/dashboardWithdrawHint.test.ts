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

// ---------------------------------------------------------------------------
// BUG THAT thu BA cung ho "goi y rut tien khong tinh het nguon tien" (2026-10-08,
// phat hien khi tu dong vai nguoi dung di het cac case voi so lieu that cua
// Pham Minh Khue 02): ca 3 nhanh deu cong input.availableBalance (DA BI FLOOR ve
// 0 boi Math.max(0, gross-debt)) thay vi hieu so THO - khi no > gross, cong thuc
// mat han phan "con thieu bao nhieu de bu het no".
// ---------------------------------------------------------------------------

// So lieu THAT cua Khue 02: gross 57.024d, no 85.536d, nguong 20.000d. Cong thuc
// cu noi "Tich luy them 20.000d" - sai, vi co them dung 20.000d gross thi Kha
// dung van la max(0, 77.024-85.536) = 0d. So dung la 48.512d (= bu 28.512d
// con thieu so voi no, CONG them 20.000d nguong).
test("no > gross: so con thieu PHAI bu ca phan vuot cua no, khong chi ngưỡng", () => {
  const html = render({
    availableBalance: 0, // max(0, 57_024 - 85_536)
    grossAvailableBalance: 57_024,
    debtRemaining: 85_536,
    entries: [entry({ status: "confirmed" })],
  });
  assert.match(html, /Tích luỹ thêm 48\.512đ/);
  assert.doesNotMatch(html, /Tích luỹ thêm 20\.000đ/, "day la so SAI da gap that tren production");
});

// Nhanh "dang bi giam" cung dinh cung bug: gross 10.000 - no 50.000 = -40.000 (am).
// Du held 30.000 co ve du (0+30.000=30.000>=20.000 theo cong thuc CU), nhung thuc
// te sau khi don giam mo khoa, gross moi = 40.000, Kha dung moi = max(0,40.000-50.000)
// = 0d - VAN KHONG DU. Cong thuc cu se noi SAI "khong can mua them gi".
test("no > gross: nhanh 'dang bi giam' khong duoc hua suong khi held cong vao van chua du", () => {
  const html = render({
    availableBalance: 0, // max(0, 10_000 - 50_000)
    grossAvailableBalance: 10_000,
    debtRemaining: 50_000,
    heldBalance: 30_000,
    heldEntries: [entry({ status: "confirmed", availableFrom: "2026-10-15" })],
    entries: [entry({ status: "confirmed", availableFrom: "2026-10-15" })],
  });
  assert.doesNotMatch(
    html,
    /không cần mua thêm gì/,
    "gross 10k + held 30k - no 50k = 0d, VAN chua du - khong duoc hua la du roi"
  );
  // 20.000 (nguong) - (10.000 + 30.000 - 50.000) = 20.000 - (-10.000) = 30.000
  assert.match(html, /Tích luỹ thêm 30\.000đ/);
});

// Nhanh "cho Shopee xac nhan" cung dinh cung bug: gross 5.000 - no 30.000 = -25.000.
// Pending 40.000 co ve du theo cong thuc CU (0+40.000=40.000>=20.000), nhung thuc te
// sau khi pending duoc duyet, gross moi = 45.000, Kha dung moi = max(0,45.000-30.000)
// = 15.000d - VAN CHUA DU 20.000d nguong. Cong thuc cu se hua SAI "duyet xong la rut
// duoc ngay".
test("no > gross: nhanh 'cho Shopee xac nhan' khong duoc hua suong khi pending cong vao van chua du", () => {
  const html = render({
    availableBalance: 0, // max(0, 5_000 - 30_000)
    grossAvailableBalance: 5_000,
    debtRemaining: 30_000,
    entries: [entry({ status: "pending", userShareAmount: 40_000 })],
  });
  assert.doesNotMatch(
    html,
    /là bạn rút được ngay/,
    "gross 5k + pending 40k - no 30k = 15k, VAN chua du 20k nguong"
  );
  // 20.000 - (5.000 + 40.000 - 30.000) = 20.000 - 15.000 = 5.000
  assert.match(html, /Tích luỹ thêm 5\.000đ/);
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
