/**
 * JS client cua trang /admin/tips (2026-10-14), dang chuoi de test duoc bang node:vm (xem
 * tipsAdminScript.test.ts). KHONG chua the <script>, backtick hay "${" de nhung an toan vao template string.
 *
 * Keo-tha dung HTML5 Drag and Drop GOC (khong thu vien): chi TAY NAM `.tip-handle` co draggable, vi the chua
 * <input>/<details>/nut nen keo ca the se lam khong boi chon duoc chu trong o nhap. Tha xong TU LUU qua
 * POST /admin/tips/reorder; luu loi thi tra the ve cho cu va bao loi de man hinh khong lech voi DB.
 * Han che da chap nhan: drag goc khong chay bang cam ung tren dien thoai (admin dung may tinh).
 */
export const TIPS_ADMIN_SCRIPT = `
function computeDropIndex(midpoints, clientY) {
  var index = 0;
  for (var i = 0; i < midpoints.length; i++) {
    if (clientY > midpoints[i]) index = i + 1;
  }
  return index;
}
function restoreOrder(list, cardsById, ids) {
  for (var i = 0; i < ids.length; i++) {
    if (cardsById[ids[i]]) list.appendChild(cardsById[ids[i]]);
  }
}
(function () {
  document.addEventListener("click", function (event) {
    var target = event.target;
    var closer = target && target.closest ? target.closest("[data-close-details]") : null;
    if (!closer) return;
    var details = closer.closest("details");
    if (details) details.removeAttribute("open");
  });

  var list = document.getElementById("tips-list");
  if (!list) return;
  var errorBox = document.getElementById("tips-order-error");
  var dragged = null;
  var previous = [];
  var line = document.createElement("li");
  line.className = "tip-drop-line";
  line.setAttribute("aria-hidden", "true");

  function cards() {
    return Array.prototype.slice.call(list.querySelectorAll("[data-tip-id]"));
  }
  function ids() {
    return cards().map(function (card) { return Number(card.getAttribute("data-tip-id")); });
  }
  function setError(message) {
    if (!errorBox) return;
    errorBox.textContent = message || "";
    errorBox.style.display = message ? "block" : "none";
  }
  function cleanup() {
    if (line.parentNode) line.parentNode.removeChild(line);
    if (dragged) dragged.classList.remove("is-dragging");
  }
  function persist(before) {
    var now = ids();
    if (now.join(",") === before.join(",")) return;
    fetch("/admin/tips/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ ids: now })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok || body.ok === false) {
          throw { userMessage: body && body.message ? body.message : "Không lưu được thứ tự." };
        }
        setError("");
      });
    }).catch(function (err) {
      var byId = {};
      cards().forEach(function (card) { byId[card.getAttribute("data-tip-id")] = card; });
      restoreOrder(list, byId, before);
      setError(err && err.userMessage ? err.userMessage : "Không lưu được thứ tự, kiểm tra kết nối rồi thử lại.");
    });
  }

  list.addEventListener("dragstart", function (event) {
    var handle = event.target && event.target.closest ? event.target.closest(".tip-handle") : null;
    if (!handle) return;
    dragged = handle.closest("[data-tip-id]");
    if (!dragged) return;
    previous = ids();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", dragged.getAttribute("data-tip-id"));
    if (event.dataTransfer.setDragImage) event.dataTransfer.setDragImage(dragged, 24, 24);
    // Them class SAU 1 nhip de anh keo (drag image) duoc chup luc the con ro net.
    setTimeout(function () { if (dragged) dragged.classList.add("is-dragging"); }, 0);
  });
  list.addEventListener("dragenter", function (event) {
    if (dragged) event.preventDefault();
  });
  list.addEventListener("dragover", function (event) {
    if (!dragged) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    var others = cards().filter(function (card) { return card !== dragged; });
    var midpoints = others.map(function (card) {
      var rect = card.getBoundingClientRect();
      return rect.top + rect.height / 2;
    });
    var ref = others[computeDropIndex(midpoints, event.clientY)] || null;
    list.insertBefore(line, ref);
  });
  list.addEventListener("drop", function (event) {
    if (!dragged) return;
    event.preventDefault();
    if (line.parentNode) list.insertBefore(dragged, line);
    cleanup();
    persist(previous);
  });
  list.addEventListener("dragend", function () {
    cleanup();
    dragged = null;
  });
})();
`;
