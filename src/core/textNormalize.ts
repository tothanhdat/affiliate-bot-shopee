/**
 * Chuan hoa xuong dong ve LF ("\n").
 *
 * Ly do ton tai (bug that 2026-09-10, phat hien tren Zalo desktop cua instance "sanhoantien"):
 * theo chuan HTML, trinh duyet nop gia tri <textarea> len server voi xuong dong dang CRLF ("\r\n").
 * Truoc day route POST /admin/settings luu nguyen xi chuoi do vao bang settings, roi Zalo desktop
 * (Chromium, white-space: pre-wrap) dem "\r" va "\n" la HAI lan xuong dong rieng biet -> moi dong
 * trong trong template bi nhan doi, tin nhan bot gian ra rat xa. Instance khac chua tung sua
 * template qua form web (van dung default hard-code trong replyText.ts, chi co "\n") thi hien binh
 * thuong - do la ly do 2 instance cung code lai hien khac nhau.
 *
 * Dung o CA hai phia: luc GHI (route /admin/settings - chan tu goc) va luc DOC
 * (LedgerStore.getSetting - de cac gia tri DA luu sai trong DB that tu khoi ma khong can admin vao
 * sua/luu lai tung template).
 */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}
