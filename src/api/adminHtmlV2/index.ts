/**
 * TAM THOI (2026-10-02) — ban giao dien MOI cua khu /admin, dung bang skill `/evon:ui-ux`.
 *
 * Hien tai moi thu con RE-EXPORT nguyen si tu ban cu. Lam dan tung trang: khi mot trang da co ban
 * moi, tao file rieng trong thu muc nay roi doi dong re-export tuong ung sang file do. Nho vay bat
 * `v2` o BAT KY thoi diem nao cung chay duoc, khong co trang trang giua chung.
 *
 * Kieu cua ca bo nay bi `AdminRenderers` (xem ../adminRenderers.ts) ep phai KHOP CHINH XAC chu ky
 * ban cu — doi tham so cua mot trang ma quen ban kia thi `npm run typecheck` do ngay.
 *
 * Khi chot giao dien moi: doi ten thu muc nay thanh chinh thuc, xoa ban cu, xoa adminRenderers.ts
 * va adminUiVersion.ts.
 */

export {
  adminShell,
  renderAdminLoginPage,
  renderOrdersPage,
  renderRecordOrdersPage,
  renderReverseConfirmPage,
  renderSettingsPage,
  renderUserCommissionPage,
  renderUsersPage,
  renderWithdrawalsPage,
} from "../adminHtml.js";

export { renderAdminDashboardPage } from "../adminDashboardHtml.js";
