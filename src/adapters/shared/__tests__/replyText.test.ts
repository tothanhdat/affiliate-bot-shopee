import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderTemplate,
  formatOrdersConfirmedCaption,
  ORDERS_CONFIRMED_CAPTION_TEMPLATE_DEFAULT,
  formatWelcomeReply,
  formatSuccessReply,
  formatWithdrawalRequestedReply,
  formatWithdrawalPaidReply,
  formatGroupJoinWelcomeReply,
  formatGroupJoinBlockedGroupReply,
  formatDashboardLinkReply,
  formatOrdersConfirmedReply,
  formatGroupReportUpdatedReply,
  WELCOME_MESSAGE_TEMPLATE_DEFAULT,
  SUCCESS_REPLY_TEMPLATE_DEFAULT,
  GROUP_JOIN_WELCOME_TEMPLATE_DEFAULT,
  GROUP_JOIN_BLOCKED_REPLY_TEMPLATE_DEFAULT,
  DASHBOARD_LINK_REPLY_TEMPLATE_DEFAULT,
  ORDERS_CONFIRMED_TEMPLATE_DEFAULT,
  WITHDRAWAL_REQUESTED_TEMPLATE_DEFAULT,
  WITHDRAWAL_PAID_TEMPLATE_DEFAULT,
  GROUP_REPORT_UPDATED_TEMPLATE_DEFAULT,
} from "../replyText.js";

test("renderTemplate: thay dung placeholder co trong vars", () => {
  const result = renderTemplate("Xin chao {{name}}, ban co {{count}} don moi.", {
    name: "An",
    count: "3",
  });
  assert.equal(result, "Xin chao An, ban co 3 don moi.");
});

test("renderTemplate: giu nguyen placeholder khong khop trong vars, khong throw", () => {
  const result = renderTemplate("Gia tri: {{unknown}}", {});
  assert.equal(result, "Gia tri: {{unknown}}");
});

test("renderTemplate: thay duoc nhieu lan xuat hien cua cung 1 placeholder", () => {
  const result = renderTemplate("{{x}} + {{x}} = 2{{x}}", { x: "5" });
  assert.equal(result, "5 + 5 = 25");
});

test("formatWelcomeReply: template mac dinh thay dung userSharePercent/botSharePercent/withdrawalThreshold/dashboardUrl", () => {
  const result = formatWelcomeReply(
    WELCOME_MESSAGE_TEMPLATE_DEFAULT,
    90,
    20_000,
    "https://example.com/d/abc123"
  );
  assert.match(result, /Bạn nhận 90% hoa hồng/);
  assert.match(result, /giữ lại 10%/);
  assert.match(result, /20\.000đ/);
  assert.match(result, /https:\/\/example\.com\/d\/abc123/);
});

test("formatWelcomeReply: template tuy chinh chi con placeholder duoc thay dung", () => {
  const result = formatWelcomeReply(
    "Ban nhan {{userSharePercent}}%, bot giu {{botSharePercent}}%, nguong rut {{withdrawalThreshold}}, dashboard {{dashboardUrl}}.",
    80,
    50_000,
    "https://example.com/d/xyz"
  );
  assert.equal(result, "Ban nhan 80%, bot giu 20%, nguong rut 50.000đ, dashboard https://example.com/d/xyz.");
});

test("formatGroupJoinWelcomeReply: template mac dinh tro toi So tay tu host, khong con Google Docs", () => {
  const result = formatGroupJoinWelcomeReply(GROUP_JOIN_WELCOME_TEMPLATE_DEFAULT, "https://bot.example.com/so-tay");
  assert.match(result, /Chào mừng vào nhà tụi mình nha/);
  assert.ok(result.includes("https://bot.example.com/so-tay"), "phai kem link So tay cua chinh instance nay");
  assert.ok(!result.includes("docs.google.com"), "khong duoc con tro ve ban Google Docs cu");
  assert.ok(!result.includes("{{"), "khong duoc con placeholder chua thay the");
});

test("formatGroupJoinWelcomeReply: thay {{handbookUrl}} theo domain cua tung instance", () => {
  const template = "Chao ban moi! So tay: {{handbookUrl}}";
  assert.equal(
    formatGroupJoinWelcomeReply(template, "https://a.example.com/so-tay"),
    "Chao ban moi! So tay: https://a.example.com/so-tay"
  );
  assert.equal(
    formatGroupJoinWelcomeReply(template, "https://b.example.com/so-tay"),
    "Chao ban moi! So tay: https://b.example.com/so-tay"
  );
});

test("formatGroupJoinWelcomeReply: template admin tu soan khong co placeholder thi giu nguyen", () => {
  const result = formatGroupJoinWelcomeReply("Chao ban moi!", "https://bot.example.com/so-tay");
  assert.equal(result, "Chao ban moi!");
});

test("formatSuccessReply: template mac dinh chua link, cau hoa hong va dong luu y cuoi", () => {
  const result = formatSuccessReply(SUCCESS_REPLY_TEMPLATE_DEFAULT, "https://s.shopee.vn/abc");
  assert.match(result, /Link đây ạ: https:\/\/s\.shopee\.vn\/abc/);
  assert.match(result, /Hoa hồng chỉ chốt được sau khi Shopee xác nhận đơn/);
  assert.match(result, /đừng lướt video\/live/);
});

test("formatSuccessReply: template mac dinh KHONG con placeholder chua duoc thay", () => {
  // Chan viec them placeholder moi vao default ma quen truyen vars tuong ung -> bot nhan
  // nguyen van "{{...}}" cho khach.
  const result = formatSuccessReply(SUCCESS_REPLY_TEMPLATE_DEFAULT, "https://s.shopee.vn/abc");
  assert.ok(!result.includes("{{"), `con placeholder chua thay trong: ${result}`);
});

test("formatSuccessReply: template CU con {{commissionLine}} van render ra cau hoa hong day du", () => {
  // Tuong thich nguoc: instance da bam Luu o /admin/settings giu template cu trong DB, gia tri DB
  // de len default trong code. Bo key nay la bot nhan nguyen van "{{commissionLine}}" cho khach.
  const result = formatSuccessReply("LINK: {{link}} | GHI CHU: {{commissionLine}}", "https://x.test");
  assert.equal(
    result,
    "LINK: https://x.test | GHI CHU: Hoa hồng chỉ chốt được sau khi Shopee xác nhận đơn nên em chưa báo số liền được — đơn confirm là em nhắn ngay nha!"
  );
});

test("formatSuccessReply: placeholder khong biet duoc giu nguyen, khong throw", () => {
  const result = formatSuccessReply("{{link}} / {{khongTonTai}}", "https://x.test");
  assert.equal(result, "https://x.test / {{khongTonTai}}");
});

test("formatWithdrawalRequestedReply: template mac dinh hien dung so tien da format VND", () => {
  const result = formatWithdrawalRequestedReply(WITHDRAWAL_REQUESTED_TEMPLATE_DEFAULT, 80_000);
  assert.match(result, /Đã ghi nhận yêu cầu rút 80\.000đ nha/);
});

test("formatWithdrawalRequestedReply: template tuy chinh chi giu lai placeholder duoc thay", () => {
  const result = formatWithdrawalRequestedReply("Rut {{amount}} nhe.", 50_000);
  assert.equal(result, "Rut 50.000đ nhe.");
});

test("formatWithdrawalPaidReply: template mac dinh co dung link dashboard", () => {
  const result = formatWithdrawalPaidReply(WITHDRAWAL_PAID_TEMPLATE_DEFAULT, "https://example.com/d/abc123");
  assert.match(result, /Tiền đã bay về bạn rồi đó/);
  assert.match(result, /https:\/\/example\.com\/d\/abc123/);
});

test("formatWithdrawalPaidReply: template tuy chinh chi giu lai placeholder duoc thay", () => {
  const result = formatWithdrawalPaidReply("Da chuyen khoan, xem tai {{dashboardUrl}}.", "https://x.test/d/1");
  assert.equal(result, "Da chuyen khoan, xem tai https://x.test/d/1.");
});

test("formatDashboardLinkReply: template mac dinh hien dung userId va dashboardUrl", () => {
  const result = formatDashboardLinkReply(DASHBOARD_LINK_REPLY_TEMPLATE_DEFAULT, "https://example.com/d/abc123", "12345");
  assert.match(result, /🆔 ID: 12345/);
  assert.match(result, /https:\/\/example\.com\/d\/abc123/);
});

test("formatDashboardLinkReply: template tuy chinh chi giu lai placeholder duoc thay", () => {
  const result = formatDashboardLinkReply("ID {{userId}} - link {{dashboardUrl}}", "https://x.test/d/1", "u1");
  assert.equal(result, "ID u1 - link https://x.test/d/1");
});

test("formatOrdersConfirmedReply: 1 don - template mac dinh hien ten don, so tien va link dashboard", () => {
  const result = formatOrdersConfirmedReply(
    ORDERS_CONFIRMED_TEMPLATE_DEFAULT,
    [{ orderId: "ORDER1", productName: "Ao thun", userShareAmount: 50_000 }],
    "https://example.com/d/abc123"
  );
  assert.match(result, /đơn "Ao thun" của bạn confirm rồi nè/);
  assert.match(result, /50\.000đ/);
  assert.match(result, /https:\/\/example\.com\/d\/abc123/);
});

test("formatOrdersConfirmedReply: nhieu don - hien tong so tien va tung dong rieng", () => {
  const result = formatOrdersConfirmedReply(
    ORDERS_CONFIRMED_TEMPLATE_DEFAULT,
    [
      { orderId: "ORDER1", productName: "Ao thun", userShareAmount: 30_000 },
      { orderId: "ORDER2", productName: null, userShareAmount: 20_000 },
    ],
    "https://example.com/d/abc123"
  );
  assert.match(result, /bạn có 2 đơn về luôn nè/);
  assert.match(result, /Ao thun: 30\.000đ/);
  assert.match(result, /Đơn ORDER2: 20\.000đ/);
  assert.match(result, /Tổng cộng: 50\.000đ/);
});

test("formatOrdersConfirmedReply: template tuy chinh chi giu lai placeholder duoc thay", () => {
  const result = formatOrdersConfirmedReply(
    "{{summaryLine}} | {{dashboardUrl}}",
    [{ orderId: "ORDER1", productName: "Ao thun", userShareAmount: 50_000 }],
    "https://x.test/d/1"
  );
  assert.equal(
    result,
    `Yayyy 🎉 đơn "Ao thun" của bạn confirm rồi nè, về túi bạn 50.000đ 💸 | https://x.test/d/1`
  );
});

// 2026-09-11 (yeu cau truc tiep cua user): sau moi lan admin import bao cao Shopee tren web, bot
// nhan vao group da duoc tick de ca group biet du lieu hoa hong vua duoc cap nhat.
test("formatGroupReportUpdatedReply: dien ngay dd/mm vao {{date}}", () => {
  const body = formatGroupReportUpdatedReply("Đơn hàng Shopee ngày {{date}} đã được cập nhật.", "10/09");
  assert.equal(body, "Đơn hàng Shopee ngày 10/09 đã được cập nhật.");
});

test("formatGroupReportUpdatedReply: template default co {{date}} va huong dan 'xemhh'", () => {
  assert.ok(GROUP_REPORT_UPDATED_TEMPLATE_DEFAULT.includes("{{date}}"), "default phai co placeholder ngay");
  const body = formatGroupReportUpdatedReply(GROUP_REPORT_UPDATED_TEMPLATE_DEFAULT, "10/09");
  assert.ok(body.includes("10/09"));
  assert.ok(body.includes("xemhh"), "phai chi cho user cach lay lai link dashboard");
  assert.ok(!body.includes("{{"), "khong duoc con placeholder chua thay the");
});

// 2026-09-24 (yeu cau truc tiep cua user): user bat "khong nhan tin nhan tu nguoi la" thi DM chao
// mung luc join group bi Zalo tu choi - bot chao bu trong group, tag ten nguoi moi.
test("formatGroupJoinBlockedGroupReply: dien ten nguoi moi vao {{name}}", () => {
  const body = formatGroupJoinBlockedGroupReply(
    "Chào {{name}} nha, em la bot.",
    "@Tô Diễm",
    "https://bot.example.com/so-tay"
  );
  assert.equal(body, "Chào @Tô Diễm nha, em la bot.");
});

test("formatGroupJoinBlockedGroupReply: thay ca {{name}} lan {{handbookUrl}}", () => {
  const body = formatGroupJoinBlockedGroupReply(
    "Chào {{name}}, xem {{handbookUrl}} nha.",
    "@Tô Diễm",
    "https://bot.example.com/so-tay"
  );
  assert.equal(body, "Chào @Tô Diễm, xem https://bot.example.com/so-tay nha.");
});

test("formatGroupJoinBlockedGroupReply: template default co {{name}} va link So tay", () => {
  assert.ok(GROUP_JOIN_BLOCKED_REPLY_TEMPLATE_DEFAULT.includes("{{name}}"), "default phai co cho chen ten");
  const body = formatGroupJoinBlockedGroupReply(
    GROUP_JOIN_BLOCKED_REPLY_TEMPLATE_DEFAULT,
    "@Tô Diễm",
    "https://bot.example.com/so-tay"
  );
  assert.ok(body.includes("@Tô Diễm"));
  assert.ok(body.includes("kết bạn"), "phai xin user chap nhan loi moi ket ban");
  assert.ok(body.includes("https://bot.example.com/so-tay"), "phai kem link So tay hoan tien");
  assert.ok(!body.includes("docs.google.com"), "khong duoc con tro ve ban Google Docs cu");
  assert.ok(!body.includes("{{"), "khong duoc con placeholder chua thay the");
});

/**
 * Uoc tinh tien hoan luc tra link (2026-10-01). Truoc do nhanh nay la code chet nen commit
 * 5f86f18 da gop cau hoa hong thang vao template; gio co nguon du lieu that (xem
 * src/core/commissionLookup.ts) nen cau hoa hong quay lai la MOT SLOT co HAI trang thai.
 */
test("formatSuccessReply: co uoc tinh thi thay cau 'chua bao so duoc' bang so tien that", () => {
  const result = formatSuccessReply(SUCCESS_REPLY_TEMPLATE_DEFAULT, "https://s.shopee.vn/abc", {
    userReceiveAmount: 9822,
  });

  assert.match(result, /9\.822đ/);
  // Hai cau nay loai tru nhau: noi "em chua bao so lien duoc" ngay canh mot con so cu the la
  // tu mau thuan truoc mat user.
  assert.doesNotMatch(result, /chưa báo số liền được/);
});

test("formatSuccessReply: khong co uoc tinh thi giu nguyen cau cho xac nhan", () => {
  const result = formatSuccessReply(SUCCESS_REPLY_TEMPLATE_DEFAULT, "https://s.shopee.vn/abc", null);
  assert.match(result, /Hoa hồng chỉ chốt được sau khi Shopee xác nhận đơn/);
  assert.ok(!result.includes("{{"), `con placeholder chua thay trong: ${result}`);
});

test("formatSuccessReply: template CU cua instance cung nhan duoc so uoc tinh", () => {
  // Instance da bam Luu truoc 2026-10-01 co "{{commissionLine}}" trong DB - ho phai duoc huong
  // tinh nang moi ma khong can sua tay template.
  const result = formatSuccessReply("LINK: {{link}} | {{commissionLine}}", "https://x.test", {
    userReceiveAmount: 12250,
  });
  assert.match(result, /12\.250đ/);
});

test("SUCCESS_REPLY_TEMPLATE_DEFAULT: PHAI con placeholder {{commissionLine}}", () => {
  // Chot coupling de gay: neu ai do lai gop cau hoa hong THANG vao template (nhu commit 5f86f18
  // tung lam luc nhanh uoc tinh con la code chet), thi so tien uoc tinh se khong bao gio hien
  // ra duoc nua - va hong am tham, khong test nao khac bat duoc.
  assert.ok(
    SUCCESS_REPLY_TEMPLATE_DEFAULT.includes("{{commissionLine}}"),
    "default template phai dung {{commissionLine}} de cau hoa hong doi duoc theo trang thai"
  );
});

/**
 * Trang thai thu BA cua {{commissionLine}} (2026-10-01): san pham da XAC MINH la khong co hoa
 * hong. Truoc do ca nay roi chung vao cau hen "doi Shopee xac nhan don" - loi hen khong bao gio
 * den vi don nay se khong bao gio co hoa hong de bao.
 */
test("formatSuccessReply: noCommission -> bao thang la chua bat hoa hong, KHONG hen suong", () => {
  const result = formatSuccessReply(SUCCESS_REPLY_TEMPLATE_DEFAULT, "https://s.shopee.vn/abc", null, true);

  assert.match(result, /chưa bật hoa hồng/);
  assert.doesNotMatch(result, /Hoa hồng chỉ chốt được sau khi Shopee xác nhận đơn/);
  assert.ok(!result.includes("{{"), `con placeholder chua thay: ${result}`);
});

test("formatSuccessReply: co so tien thi KHONG bao gio hien cau 'chua bat hoa hong'", () => {
  // Phong truong hop caller truyen nham ca hai - co so tien that thi noCommission chac chan sai.
  const result = formatSuccessReply(SUCCESS_REPLY_TEMPLATE_DEFAULT, "https://s.shopee.vn/abc", {
    userReceiveAmount: 28512,
  }, true);

  assert.match(result, /28\.512đ/);
  assert.doesNotMatch(result, /chưa bật hoa hồng/);
});

test("formatSuccessReply: khong biet (null, false) -> van la cau hen nhu cu", () => {
  // Ranh gioi quan trong nhat cua tinh nang nay: API timeout / het han muc / tat tinh nang deu roi
  // vao day. Noi "san pham chua bat hoa hong" o ca nay la noi SAI ve mot san pham binh thuong.
  const result = formatSuccessReply(SUCCESS_REPLY_TEMPLATE_DEFAULT, "https://s.shopee.vn/abc", null, false);

  assert.match(result, /Hoa hồng chỉ chốt được sau khi Shopee xác nhận đơn/);
  assert.doesNotMatch(result, /chưa bật hoa hồng/);
});

// MOT SLOT, hai trang thai loai tru nhau - giong {{commissionLine}}. Khong bao gio hien ca hai.
test("formatOrdersConfirmedReply: khong co don bi giam -> {{heldLine}} thanh chuoi rong", () => {
  const text = formatOrdersConfirmedReply(
    ORDERS_CONFIRMED_TEMPLATE_DEFAULT,
    [{ orderId: "A", productName: "San pham", userShareAmount: 10_000 }],
    "https://bot.example.com/d/tok"
  );
  assert.doesNotMatch(text, /\{\{heldLine\}\}/, "placeholder phai duoc render, khong lot nguyen van");
  assert.doesNotMatch(text, /mở khoá/);
});

test("formatOrdersConfirmedReply: co don bi giam -> them cau giai thich", () => {
  const text = formatOrdersConfirmedReply(
    ORDERS_CONFIRMED_TEMPLATE_DEFAULT,
    [
      { orderId: "BIG", productName: "May anh", userShareAmount: 150_000 },
      { orderId: "SMALL", productName: "Ao thun", userShareAmount: 16_000 },
    ],
    "https://bot.example.com/d/tok",
    { amountVnd: 150_000, unlockDayText: "15/10" }
  );
  assert.match(text, /Trong đó 150\.000đ mở khoá từ 15\/10/);
  assert.match(text, /Tổng cộng: 166\.000đ/, "tong van tinh tren TAT CA don");
});

test("formatOrdersConfirmedCaption: cung mot slot 2 trang thai", () => {
  const plain = formatOrdersConfirmedCaption(ORDERS_CONFIRMED_CAPTION_TEMPLATE_DEFAULT, "https://x/d/t");
  assert.doesNotMatch(plain, /mở khoá/);
  const withHeld = formatOrdersConfirmedCaption(
    `{{dashboardUrl}}{{heldLine}}`,
    "https://x/d/t",
    { amountVnd: 150_000, unlockDayText: "15/10" }
  );
  assert.match(withHeld, /mở khoá từ 15\/10/);
});

// ---------------------------------------------------------------------------
// debtLine - no hoan tra CO THE den tu mot lan import KHAC (2026-10-08)
// ---------------------------------------------------------------------------

test("formatOrdersConfirmedReply: khong co no -> {{debtLine}} thanh chuoi rong", () => {
  const text = formatOrdersConfirmedReply(
    ORDERS_CONFIRMED_TEMPLATE_DEFAULT,
    [{ orderId: "A", productName: "San pham", userShareAmount: 10_000 }],
    "https://bot.example.com/d/tok"
  );
  assert.doesNotMatch(text, /\{\{debtLine\}\}/, "placeholder phai duoc render, khong lot nguyen van");
  assert.doesNotMatch(text, /nợ hoàn trả/);
});

// Day la CA CHINH user yeu cau: user dang no 120k TU MOT LAN IMPORT KHAC (khong lien quan don trong
// lo nay), lo nay chi co 2 don MOI ve - nhung tin nhan PHAI giai thich vi sao Kha dung thap hon Tong
// cong cua lo, ngay trong lan import nay chu khong doi user tu mo dashboard moi biet.
test("formatOrdersConfirmedReply: co no TU TRUOC (khong lien quan don trong lo) -> giai thich ngay", () => {
  const text = formatOrdersConfirmedReply(
    ORDERS_CONFIRMED_TEMPLATE_DEFAULT,
    [
      { orderId: "NEW1", productName: "San pham 1", userShareAmount: 20_000 },
      { orderId: "NEW2", productName: "San pham 2", userShareAmount: 30_000 },
    ],
    "https://bot.example.com/d/tok",
    null,
    120_000
  );
  assert.match(text, /Đã trừ 120\.000đ nợ hoàn trả/);
  assert.match(text, /Tổng cộng: 50\.000đ/, "tong van la tien cua LO nay, khong tru no");
});

test("formatOrdersConfirmedReply: co CA giam lan no cung luc -> ca hai cau deu xuat hien", () => {
  const text = formatOrdersConfirmedReply(
    ORDERS_CONFIRMED_TEMPLATE_DEFAULT,
    [{ orderId: "BIG", productName: "May anh", userShareAmount: 150_000 }],
    "https://bot.example.com/d/tok",
    { amountVnd: 150_000, unlockDayText: "15/10" },
    40_000
  );
  assert.match(text, /Trong đó 150\.000đ mở khoá từ 15\/10/);
  assert.match(text, /Đã trừ 40\.000đ nợ hoàn trả/);
});

test("formatOrdersConfirmedCaption: debtLine cung mot slot 2 trang thai", () => {
  const plain = formatOrdersConfirmedCaption(ORDERS_CONFIRMED_CAPTION_TEMPLATE_DEFAULT, "https://x/d/t");
  assert.doesNotMatch(plain, /nợ hoàn trả/);
  const withDebt = formatOrdersConfirmedCaption(
    `{{dashboardUrl}}{{debtLine}}`,
    "https://x/d/t",
    null,
    40_000
  );
  assert.match(withDebt, /Đã trừ 40\.000đ nợ hoàn trả/);
});

// Mac dinh caption KHONG chua {{debtLine}} (giong {{heldLine}}): anh da tu ve dieu nay roi, caption
// chi can chi duong vao dashboard - tranh lap lai 2 lan cung mot thong tin.
test("formatOrdersConfirmedCaption: default template KHONG lap lai debtLine du co no", () => {
  const caption = formatOrdersConfirmedCaption(ORDERS_CONFIRMED_CAPTION_TEMPLATE_DEFAULT, "https://x/d/t", null, 40_000);
  assert.doesNotMatch(caption, /nợ hoàn trả/);
});
