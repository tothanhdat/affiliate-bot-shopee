/**
 * JS client cua trang /admin/tips (2026-10-14), dang chuoi de test duoc bang node:vm (xem
 * tipsAdminScript.test.ts) - giong cach cac script khac cua /admin. KHONG chua the <script>, KHONG chua
 * backtick hay "${" de nhung an toan vao template string.
 *
 * Ban nay chi co handler dong <details> (nut "Huy" cua khoi xoa + nut dong form); phan keo-tha them o buoc sau.
 */
export const TIPS_ADMIN_SCRIPT = `
(function () {
  document.addEventListener("click", function (event) {
    var target = event.target;
    var closer = target && target.closest ? target.closest("[data-close-details]") : null;
    if (!closer) return;
    var details = closer.closest("details");
    if (details) details.removeAttribute("open");
  });
})();
`;
