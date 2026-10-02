/**
 * TAM THOI (2026-10-02) — chon bo ham render theo giao dien dang bat (xem adminUiVersion.ts).
 *
 * `AdminRenderers` lay kieu TU BAN CU (`typeof V1`), nen ban `v2` bat buoc phai co du moi trang va
 * dung chu ky — thieu mot trang hay lech mot tham so la typecheck do, khong phai doi den luc mo
 * trinh duyet moi thay. Day la cai chot giu loi hua "du function nhu giao dien cu".
 *
 * CA FILE NAY SE BI XOA khi chot giao dien moi.
 */

import {
  adminShell,
  renderAdminLoginPage,
  renderOrdersPage,
  renderRecordOrdersPage,
  renderReverseConfirmPage,
  renderSettingsPage,
  renderUserCommissionPage,
  renderUsersPage,
  renderWithdrawalsPage,
} from "./adminHtml.js";
import { renderAdminDashboardPage } from "./adminDashboardHtml.js";
import * as v2 from "./adminHtmlV2/index.js";
import type { AdminUiVersion } from "./adminUiVersion.js";

const V1 = {
  adminShell,
  renderAdminDashboardPage,
  renderAdminLoginPage,
  renderOrdersPage,
  renderRecordOrdersPage,
  renderReverseConfirmPage,
  renderSettingsPage,
  renderUserCommissionPage,
  renderUsersPage,
  renderWithdrawalsPage,
};

export type AdminRenderers = typeof V1;

const V2: AdminRenderers = {
  adminShell: v2.adminShell,
  renderAdminDashboardPage: v2.renderAdminDashboardPage,
  renderAdminLoginPage: v2.renderAdminLoginPage,
  renderOrdersPage: v2.renderOrdersPage,
  renderRecordOrdersPage: v2.renderRecordOrdersPage,
  renderReverseConfirmPage: v2.renderReverseConfirmPage,
  renderSettingsPage: v2.renderSettingsPage,
  renderUserCommissionPage: v2.renderUserCommissionPage,
  renderUsersPage: v2.renderUsersPage,
  renderWithdrawalsPage: v2.renderWithdrawalsPage,
};

export function adminRenderers(version: AdminUiVersion): AdminRenderers {
  return version === "v2" ? V2 : V1;
}
