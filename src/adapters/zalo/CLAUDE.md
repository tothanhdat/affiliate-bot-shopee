# Zalo Group Adapter (`zca-js`)

Quyết định kỹ thuật cần biết trước khi động vào `src/adapters/zalo/`. Tách khỏi `CLAUDE.md` gốc (2026-09-02), nội dung giữ nguyên.

- Type definitions gốc của `zca-js` bị lỗi (`index.d.ts` ở root làm `export * from "./dist"` thiếu phần mở rộng file, không resolve được dưới `moduleResolution: NodeNext`). Đã fix bằng `paths` override trong `tsconfig.json` trỏ thẳng tới `./node_modules/zca-js/dist/index.d.ts` (file này có đầy đủ extension `.js`, hợp lệ). Đừng xoá override này hoặc "dọn dẹp" tsconfig mà không kiểm tra lại `npm run typecheck` — sẽ lại hỏng.
- Đăng nhập ưu tiên session đã lưu (`ZALO_SESSION_PATH`) qua `zalo.login(credentials)`; chỉ fallback sang `zalo.loginQR()` khi chưa có session hoặc session hết hạn. Credentials (cookie/imei/userAgent) lấy từ event `LoginQRCallbackEventType.GotLoginInfo` trong callback của `loginQR`, lưu qua `session.ts`.
- Message handler dùng `message.data.uidFrom` làm `userId` (rate-limit/log key) và phải bỏ qua `message.isSelf === true` (tránh vòng lặp echo) cũng như bỏ qua nội dung không phải string (sticker/ảnh...).
- Handler được gọi qua `.catch()` ở nơi đăng ký listener (không phải `await` trực tiếp trong callback đồng bộ của `api.listener.on`) — giữ nguyên pattern này để một tin nhắn lỗi không làm crash cả process qua unhandled rejection.
