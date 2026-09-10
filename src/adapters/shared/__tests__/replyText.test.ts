import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderTemplate,
  formatWelcomeReply,
  formatSuccessReply,
  formatWithdrawalRequestedReply,
  formatWithdrawalPaidReply,
  formatGroupJoinWelcomeReply,
  formatDashboardLinkReply,
  formatOrdersConfirmedReply,
  WELCOME_MESSAGE_TEMPLATE_DEFAULT,
  SUCCESS_REPLY_TEMPLATE_DEFAULT,
  GROUP_JOIN_WELCOME_TEMPLATE_DEFAULT,
  DASHBOARD_LINK_REPLY_TEMPLATE_DEFAULT,
  ORDERS_CONFIRMED_TEMPLATE_DEFAULT,
  WITHDRAWAL_REQUESTED_TEMPLATE_DEFAULT,
  WITHDRAWAL_PAID_TEMPLATE_DEFAULT,
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

test("formatGroupJoinWelcomeReply: template mac dinh co link so tay", () => {
  const result = formatGroupJoinWelcomeReply(GROUP_JOIN_WELCOME_TEMPLATE_DEFAULT);
  assert.match(result, /Chào mừng vào nhà tụi mình nha/);
  assert.match(result, /docs\.google\.com\/document\/d\/1-Dc7L6fHg350j3sVlpMPxZLgObspwov1gTY9eM4ajSk/);
});

test("formatGroupJoinWelcomeReply: tra nguyen template, khong xu ly placeholder", () => {
  const result = formatGroupJoinWelcomeReply("Chao ban moi!");
  assert.equal(result, "Chao ban moi!");
});

test("formatSuccessReply: template mac dinh chua link va dong luu y cuoi", () => {
  const result = formatSuccessReply(SUCCESS_REPLY_TEMPLATE_DEFAULT, "lazada", "https://example.com/aff", null);
  assert.match(result, /Link đây ạ: https:\/\/example\.com\/aff/);
  assert.match(result, /Lưu ý quan trọng/);
});

test("formatSuccessReply: merchant shopee khong co commissionEstimate -> dong thong bao rieng cho shopee", () => {
  const result = formatSuccessReply(SUCCESS_REPLY_TEMPLATE_DEFAULT, "shopee", "https://s.shopee.vn/abc", null);
  assert.match(result, /Shopee chưa cho xem giá/);
});

test("formatSuccessReply: co commissionEstimate -> hien dong % va so tien uoc tinh", () => {
  const result = formatSuccessReply(SUCCESS_REPLY_TEMPLATE_DEFAULT, "tiktokshop", "https://example.com/aff", {
    ratePercent: 3.888,
    estimatedAmount: 12_345,
    currency: "VND",
  });
  assert.match(result, /~3\.9% \(~12\.345đ\)/);
});

test("formatSuccessReply: template tuy chinh chi giu lai placeholder duoc thay", () => {
  const result = formatSuccessReply("LINK: {{link}} | GHI CHU: {{commissionLine}}", "lazada", "https://x.test", null);
  assert.equal(
    result,
    "LINK: https://x.test | GHI CHU: Đơn cần thời gian để hệ thống affiliate xác nhận, mình sẽ chủ động nhắn tin cho bạn khi đơn hoàn tất nhé."
  );
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
