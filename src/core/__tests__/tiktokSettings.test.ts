import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TIKTOK_PROVIDER_DOWN_TEMPLATE_DEFAULT,
  TIKTOK_NO_COMMISSION_TEMPLATE_DEFAULT,
} from "../../adapters/shared/replyText.js";
import { SETTINGS_KEYS } from "../settingsKeys.js";
import { SETTINGS_REGISTRY } from "../../config/settingsRegistry.js";

test("cau bao tri dung NGUYEN VAN chu bot da chot - khong tu bien tau", () => {
  assert.equal(
    TIKTOK_PROVIDER_DOWN_TEMPLATE_DEFAULT,
    "Hệ thống Affiliate của Tiktok đang bảo trì, hãy thử lại sau 30 phút nữa"
  );
});

test("cau 'chua bat hoa hong' KHONG duoc hua thu lai sau", () => {
  // 30 phut nua san pham do VAN khong co hoa hong - hua thu lai la noi sai.
  const text = TIKTOK_NO_COMMISSION_TEMPLATE_DEFAULT.toLowerCase();
  assert.ok(!text.includes("thử lại"), "khong duoc chua 'thu lai'");
  assert.ok(!text.includes("bảo trì"), "khong duoc chua 'bao tri'");
});

test("2 setting moi co mat trong SETTINGS_REGISTRY de admin sua duoc", () => {
  const keys = SETTINGS_REGISTRY.map((f) => f.key);
  assert.ok(keys.includes(SETTINGS_KEYS.tiktokProviderDownTemplate));
  assert.ok(keys.includes(SETTINGS_KEYS.tiktokNoCommissionTemplate));
});
