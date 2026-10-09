import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveErrorUserMessage } from "../providerErrorReply.js";
import { AlertThrottle } from "../../../core/alertThrottle.js";
import { ProviderUnavailableError, ProductNotAffiliateEligibleError } from "../../../core/errors.js";

const store = { getTiktokProviderDownTemplate: (d: string) => d };

test("ProviderUnavailableError -> cau bao tri + bao admin", () => {
  const sent: string[] = [];
  const msg = resolveErrorUserMessage(new ProviderUnavailableError("server_error", "boom"), {
    ledgerStore: store,
    alertThrottle: new AlertThrottle(60_000),
    notifyAdmin: async (t) => {
      sent.push(t);
    },
  });
  assert.equal(msg, "Hệ thống Affiliate của Tiktok đang bảo trì, hãy thử lại sau 30 phút nữa");
  assert.equal(sent.length, 1);
  assert.ok(sent[0].includes("server_error"));
});

test("template admin da sua duoc uu tien hon default", () => {
  const msg = resolveErrorUserMessage(new ProviderUnavailableError("x", "y"), {
    ledgerStore: { getTiktokProviderDownTemplate: () => "cau rieng" },
  });
  assert.equal(msg, "cau rieng");
});

test("cung ma loi lap lai trong cua so -> chi bao admin 1 lan, user van nhan cau bao tri", () => {
  const sent: string[] = [];
  const ctx = {
    ledgerStore: store,
    alertThrottle: new AlertThrottle(60_000),
    notifyAdmin: async (t: string) => {
      sent.push(t);
    },
  };
  for (let i = 0; i < 5; i++) {
    const msg = resolveErrorUserMessage(new ProviderUnavailableError("server_error", "boom"), ctx);
    assert.ok(msg.includes("bảo trì"));
  }
  assert.equal(sent.length, 1);
});

test("loi ve san pham (chua bat hoa hong) KHONG bao tri, KHONG bao admin", () => {
  const sent: string[] = [];
  const err = new ProductNotAffiliateEligibleError("no commission");
  const msg = resolveErrorUserMessage(err, {
    ledgerStore: store,
    alertThrottle: new AlertThrottle(60_000),
    notifyAdmin: async (t) => {
      sent.push(t);
    },
  });
  assert.equal(msg, err.userMessage);
  assert.equal(sent.length, 0);
});

test("loi la -> cau chung chung", () => {
  assert.ok(resolveErrorUserMessage(new Error("?"), { ledgerStore: store }).includes("lỗi"));
});

test("notifyAdmin tu no nem loi cung khong lam hong luong tra loi user", async () => {
  const msg = resolveErrorUserMessage(new ProviderUnavailableError("x", "y"), {
    ledgerStore: store,
    alertThrottle: new AlertThrottle(60_000),
    notifyAdmin: async () => {
      throw new Error("telegram down");
    },
  });
  await new Promise((r) => setImmediate(r));
  assert.ok(msg.includes("bảo trì"));
});
