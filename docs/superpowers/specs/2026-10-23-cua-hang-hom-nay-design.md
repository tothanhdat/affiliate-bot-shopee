# Trang "Cửa hàng hôm nay" — mô phỏng 3D lượt tạo link theo ngày

- **Ngày:** 2026-10-23
- **Trạng thái:** Spec chờ duyệt (chưa code)
- **Yêu cầu gốc:** chủ bot muốn nhìn vào là biết lưu lượng user tạo link Shopee/TikTok nhiều hay ít và là ai; người tạo nhiều link "ghé cửa hàng" nhiều lần; người active nhưng không tạo link trong ngày thì dạo ngoài đường. Ảnh/video tham chiếu: diorama 3D isometric, 2 cửa hàng Shopee và TikTok ở hai góc một ngã tư, nhân vật chibi kèm bong bóng avatar + tên.

## 1. Quyết định đã chốt

| Mục | Quyết định |
|---|---|
| Kỹ thuật dựng | Three.js, **tự dựng toàn bộ bằng code** (cửa hàng, đường phố, nhân vật chibi). Không dùng model CC0, không video/GIF/ảnh nền. |
| Ý nghĩa 1 lượt vào shop | **1 link tạo THÀNH CÔNG** ở sàn đó. Không phải đơn hàng/giao dịch. Túi hàng chỉ là hình minh hoạ; không chữ nào nói "mua"/"đặt". |
| Đếm | Chỉ `outcome='success'`, mỗi link 1 lượt kể cả trùng link. |
| Nền tảng | Chỉ user **Zalo** (`platform='zalo'`). |
| Active | Có ≥ 1 link thành công trong **7 ngày lịch** D−6…D (giờ VN), không phải 168 giờ. |
| Ngày xem (D) | "Hôm nay" hoặc "Hôm qua"; ngày = [00:00, 00:00 ngày sau) giờ Asia/Ho_Chi_Minh. |
| Số nhân vật | Tối đa **30**. |
| Sức chứa shop | Tối đa **5 người bên trong cùng lúc** + tối đa **10 ô chờ** ngoài cửa. |
| Hàng chờ theo dữ liệu | Độ dài mục tiêu = `min(10, ceil(U_S / 2), E_S − 1)`. `U_S` = số user unique tạo link thành công ở shop S trong ngày D, **đếm trên toàn bộ dữ liệu** (không chỉ 30 nhân vật). `E_S` = số nhân vật trong cảnh có ≥ 1 lượt ghé S (chặn trên, vì không có khách giả). Hàng chờ chỉ gồm người thật sự có link ở shop đó; 1 user = 1 người dù có bao nhiêu link (chi tiết mục 6). |
| Bảng đếm trên biển hiệu | Mỗi shop có bảng nổi "🔗 N link hôm nay" (đếm trên **mọi** user Zalo ngày D, khớp dòng tóm tắt); TikTok tắt → "Tạm đóng cửa". "Hôm qua" → "N link hôm qua". |
| ×N trên nhãn | Tổng số link ngày D của user đó (cả 2 sàn), cố định từ lúc tải trang, không đếm dần. 0 link → không hiện. |
| Lặp | Cảnh **diễn lại** các lượt của ngày D liên tục (có chú thích rõ). |
| Cập nhật | Dữ liệu chụp lúc tải trang; không poll, không request nào sau khi tải. |
| Tương tác | **Không có** (không hover/click nhân vật hay thẻ). |
| TikTok tắt | Cửa hàng vẫn vẽ nhưng **kéo cửa cuốn**. |
| Bảng bên cạnh | Thẻ HTML có chiều sâu: "*minhlee* vừa săn **Áo linen…** · Shopee · 14:32". |
| Menu | "Cửa hàng hôm nay", ngay dưới "Tổng quan". Route `GET /admin/cua-hang`. |
| Thiết bị | Chỉ máy tính (kiểm ở 1440×900). |

## 2. Kiến trúc

```
logStore.listZaloLinkActivity(fromUtc, toUtc)   ─┐  (chỉ đọc)
ledgerStore.getUserProfilesMap('zalo')           ─┤  (chỉ đọc)
                                                 ▼
route GET /admin/cua-hang (server.ts, requireAdminAuth)
                                                 ▼
src/core/storeTraffic.ts  (THUẦN: không DB, không express, không three)
   → StoreTrafficResult { summary, feed, scene }
                                                 ▼
adminStoreHtml.ts: render khung trang + tóm tắt + bảng tin (server, escapeHtml)
                 + <script type="application/json"> scene (embedJson)
                 + <script type="module" src="/admin/assets/store-scene.js">
                                                 ▼
TRÌNH DUYỆT  src/web/storeScene/
   sim/   (THUẦN TS, không three — test bằng tsx): graph, pathfinding, reservations,
          state machine, director, rng
   render/ (Three.js): scene, stores, environment, characters, labels, quality
   main.ts: đọc JSON → sim → render loop
```

- **Ranh giới:** `src/core/storeTraffic.ts` không import gì từ DB/express/three. Lớp đọc dữ liệu là 2 hàm mới trong store hiện có. Không hàm nào ghi DB; không chạm luồng tạo link hay luồng tiền.
- **Build:** thêm devDependency `esbuild` + `three`. `npm run build:scene` = esbuild bundle `src/web/storeScene/main.ts` → `public/store-scene.js` (minify, tree-shake). Thêm vào `build` và `dev`. `public/` đã gitignore, đã được serve ở `/admin/assets` (cache `immutable` + `?v=` theo mtime như `admin.css` — dùng lại cơ chế `adminCssHref()`).
- **TypeScript:** `tsconfig.json` chính **loại `src/web/`** (không có lib DOM); thêm `tsconfig.web.json` (lib `ES2022` + `DOM`, `noEmit`) và gộp vào `npm run typecheck`. `npm test` thêm glob `src/web/storeScene/sim/__tests__/*.test.ts`.
- **Ngoại lệ "JS phía client" trong khu admin:** đây là bundle client lớn nhất dự án; ghi vào `.claude/rules/admin-ui-nen-tang.md`. Không dùng CDN.

## 3. Data contract

### 3.1 Lớp đọc (repository)

```ts
// logStore.ts — SELECT rowid, user_id, merchant, timestamp, product_name
//   FROM requests WHERE platform='zalo' AND outcome='success'
//   AND timestamp >= ? AND timestamp < ?  ORDER BY timestamp ASC, rowid ASC
interface LinkActivityRow {
  userId: string;
  merchant: string | null;
  timestamp: string;        // ISO UTC (toISOString) — so sánh chuỗi dùng được index timestamp
  productName: string | null;
}
listZaloLinkActivity(fromUtcIso: string, toUtcIso: string): LinkActivityRow[];

// ledgerStore.ts
getUserProfilesMap(platform: "zalo"): Map<string, { displayName: string; avatarUrl: string | null }>;
```

Mốc: `fromUtc` = 00:00 VN ngày D−6 đổi sang UTC; `toUtc` = 00:00 VN ngày D+1 đổi sang UTC. Hàm đổi mốc nằm trong `vietnamDate.ts` (có test).

### 3.2 `storeTraffic.ts` (thuần)

```ts
buildStoreTraffic(input: {
  rows: LinkActivityRow[];                 // đã lọc 7 ngày
  profiles: Map<string, {displayName: string; avatarUrl: string | null}>;
  dayVn: string;                           // "YYYY-MM-DD"
  tiktokOpen: boolean;                     // từ cấu hình (MERCHANTS có tiktokshop)
  safeAvatar: (url: string | null) => string | null;   // safeAvatarUrl được tiêm vào
}): StoreTrafficResult;

interface StoreTrafficResult {
  summary: {
    dayVn: string;
    visitorsToday: number;     // user có ≥1 link trong ngày D
    shopeeLinks: number;       // link Shopee ngày D (toàn bộ, không bị giới hạn 30)
    tiktokLinks: number;
    activeUsers7d: number;
    shownCharacters: number;   // ≤ 30
  };
  feed: FeedItem[];            // link ngày D của MỌI user Zalo, mới nhất trước, tối đa 200
  feedOverflow: number;        // số dòng bị cắt
  scene: StoreSceneData;
}
interface FeedItem { name: string; avatarUrl: string | null; initials: string;
  merchant: "shopee" | "tiktokshop"; timeVn: string /* "HH:mm" */; productName: string | null; }
```

**Dữ liệu gửi xuống trình duyệt** (nhúng qua `embedJson`, KHÔNG chứa `userId`, KHÔNG chứa giờ):

```ts
interface StoreSceneData {
  dayVn: string;
  isToday: boolean;               // chữ "hôm nay"/"hôm qua" trên bảng đếm
  tiktokOpen: boolean;
  storeLinks: { shopee: number; tiktokshop: number };   // = summary.shopeeLinks/tiktokLinks (mọi user)
  storeUsers: { shopee: number; tiktokshop: number };   // U_S: số user UNIQUE có ≥1 link ở sàn đó ngày D (mọi user)
  characters: SceneCharacter[];   // ≤ 30, theo thứ tự ưu tiên
}
interface SceneCharacter {
  key: string;            // "c01".."c30" — theo thứ tự ưu tiên
  seed: number;           // FNV-1a 32-bit của userId: ổn định theo user, dùng làm seed PRNG
  variant: number;        // 0..49, đã phân bổ không trùng
  name: string;           // đã qua quy tắc tên dự phòng
  initials: string;
  avatarUrl: string | null;   // đã qua safeAvatarUrl
  visits: Array<"shopee" | "tiktokshop">;   // thứ tự thời gian thật của ngày D; [] = chỉ dạo
}
```

### 3.3 Quy tắc

- **Chọn 30:** (1) số link ngày D giảm dần → (2) timestamp link gần nhất trong 7 ngày giảm dần → (3) `userId` tăng dần.
- **Thứ tự lượt ghé / bảng tin:** `timestamp`, trùng thì `rowid` (thứ tự ghi).
- **Merchant khác `shopee`/`tiktokshop`** (không nên có vì sàn đã ngưng bị chặn từ trước): bỏ khỏi lượt ghé và bảng tin, vẫn tính user là active.
- **Tên dự phòng:** profile thiếu hoặc `displayName` rỗng sau trim → `Khách …` + 4 ký tự cuối `userId`. **Initials:** chữ cái đầu của từ đầu + từ cuối (giống `userAvatar()`), tên dự phòng → `K`.
- **Avatar:** chỉ qua `safeAvatarUrl()` (export từ `adminHtml.ts`); bị từ chối → `null` → bong bóng hiện initials.
- **Phân bổ mẫu (không trùng trong cảnh):** sắp các nhân vật đã chọn theo `seed` tăng dần (trùng seed → `key`); với mỗi người `v = seed mod 50`, nếu đã dùng thì `v = (v+1) mod 50` cho tới khi trống. 30 ≤ 50 nên luôn đủ. Đánh đổi đã chấp nhận: thường một user giữ nguyên mẫu, nhưng có thể đổi khi tập người trong cảnh đổi.
- **50 mẫu là bảng cố định** (`variants.ts`, không sinh ngẫu nhiên) = tổ hợp kiểu tóc × trang phục × phụ kiện × bảng màu × tỉ lệ cơ thể (±8%), chọn tay để mẫu nào cũng khác mẫu khác ở ít nhất 2 trong 3 chiều hình dáng (tóc / trang phục / phụ kiện).

## 4. Trang

- Đầu trang: 2 tab-link **Hôm nay / Hôm qua** (`?ngay=homqua`, render server; giá trị lạ → hôm nay) + dòng tóm tắt *"Ngày 23/10: 12 người ghé cửa hàng · 25 link Shopee · 4 link TikTok · 28 người active 7 ngày"* (+ *"Cảnh hiển thị 30/N người"* khi N > 30).
- Trái: khung cảnh 3D (flex-1, tỉ lệ 16:10). Phải: cột bảng tin 340px (300px khi viewport < 1440), cao bằng cảnh, cuộn. Thẻ: avatar, "**tên** vừa săn **sản phẩm**" (không có tên SP → "**tên** vừa tạo link Shopee"), chip sàn, giờ VN thật. Ngày không có link → "Chưa có lượt tạo link nào trong ngày".
- Dưới cảnh, chú thích bắt buộc: *"Cảnh diễn lại các lượt tạo link thành công của ngày dd/mm với nhịp rút gọn. Mỗi lần vào cửa hàng = 1 link, không phải đơn hàng. Giờ thật xem ở bảng bên cạnh."*
- **Dự phòng:** khung cảnh chứa sẵn chữ "Đang tải cảnh 3D…". WebGL không tạo được (try/catch quanh `WebGLRenderer`) hoặc bundle tải lỗi (`onerror` trên thẻ script) → thay bằng "Không hiển thị được cảnh 3D trên trình duyệt này." Tóm tắt + bảng tin không phụ thuộc JS.

## 5. Cảnh 3D

- **Camera:** `OrthographicCamera`, yaw 45° / pitch ~35° là điểm khởi đầu, **chỉnh theo ảnh tham chiếu** khi kiểm bằng mắt. Cố định, không xoay/zoom; resize chỉ đổi frustum.
- **Bố cục:** ngã tư ở giữa, vạch sang đường 4 cạnh, viền lề vàng, vỉa hè nhô. Shopee góc sau trái, TikTok góc sau phải; 2 sân trước có cây, ghế, đèn, bồn cây. Không thêm toà nhà.
- **Shopee:** thân cam/trắng, mái hiên sọc, biển hiệu túi chữ S (texture canvas), mặt kính, đèn vàng ấm bên trong, 3 kệ + quầy. **TikTok:** thân tối, dải neon cyan/hồng (emissive), biển nốt nhạc. **Đóng cửa:** cửa cuốn xuống, biển tắt, bảng "Tạm đóng cửa".
- **Bảng đếm trên biển hiệu:** phần tử `CSS2DRenderer` neo phía trên biển hiệu mỗi shop: "🔗 25 link hôm nay" (lấy `storeLinks`), cỡ chữ lớn hơn nhãn tên, màu theo shop (cam / đen viền neon). Bảng cho biết **số link**; hàng chờ cho biết **số người** — hai thứ khác nhau vì một người tạo được nhiều link.
- **Ánh sáng:** HemisphereLight + 1 DirectionalLight đổ bóng (PCFSoft), ACES tone mapping, bóng tròn mờ dưới chân nhân vật. Bloom (UnrealBloomPass, ngưỡng cao để chỉ neon + đèn sáng) là **tuỳ chọn** theo mức chất lượng. AO không có ở bản đầu.
- **Nhân vật:** đầu ~45% chiều cao, mắt, má hồng, tóc rời, thân, tay/chân xoay quanh khớp, giày, phụ kiện. Hình khối + vật liệu dùng chung giữa các nhân vật (vật liệu theo bảng màu được cache). Hoạt ảnh bằng code: đi (tay chân ngược pha, nhún), đứng (thở), xem hàng (quay vào kệ, với tay). Túi xuất hiện khi rời kệ: cam = Shopee, đen = TikTok, mỗi tay tối đa 1 túi.

### 5.1 Nhãn tên

- Dùng `CSS2DRenderer` (phần tử DOM, luôn quay về camera): viên thuốc trắng, avatar tròn (`background-image`, URL đã qua `safeAvatarUrl`) hoặc initials, tên (`textContent`, tối đa 120px, `…`), rồi chip **×N** đậm (N = `visits.length`, tổng cả 2 sàn) — không hiện khi N = 0, nên người chỉ đi dạo có nhãn chỉ tên. N cố định suốt phiên, không tăng theo hoạt ảnh.
- **Thứ tự trước/sau:** mỗi khung hình đặt `zIndex` theo khoảng cách tới camera (gần hơn đè lên xa hơn) — tự làm, không phụ thuộc hành vi mặc định của thư viện.
- **Chồng nhãn:** độ cao nhãn có 3 mức xen kẽ theo thứ tự `key`.
- **Che khuất:** **không có điểm đi bộ nào nằm sau một toà nhà theo góc camera** (ràng buộc thiết kế đồ thị, có test hình học — mục 9). Nhân vật trong shop nhìn qua kính nên nhãn của họ hiện là đúng ý. Vì vậy không cần xử lý nhãn bị vật che.

## 6. Đồ thị đường đi + giữ chỗ

**Đồ thị viết tay** (`graph.ts`), toạ độ mặt phẳng XZ. Loại điểm: spawn (4 mép bản đồ) · vỉa hè · đầu vạch sang đường (qua đường **chỉ** bằng cạnh vạch) · cửa ngoài ↔ cửa trong (mỗi shop) · 5 chỗ xem hàng (mỗi shop) · 10 ô chờ (mỗi shop, xếp thành hàng **uốn dọc vỉa hè** cạnh cửa; ô 1 sát cửa) · vòng dạo quanh 2 sân trước · ghế. Hai hàng chờ: các ô cách đều nhau (khoảng cách cố định ~0.7 đơn vị, đủ để 10 người đọc ra là một hàng dài chứ không dồn cụm), **không chắn vạch sang đường và không đứng trước mặt kính** của shop (test hình học).

- **Tìm đường:** Dijkstra trên đồ thị tĩnh (không khoá cạnh động); kết quả xác định. Đồ thị bắt buộc liên thông (test).
- **Làn:** mỗi cạnh có 2 làn, mỗi nhân vật đi lệch sang **phải theo hướng đi** một khoảng `0.25 + (seed mod 3)·0.05` → người ngược chiều không đối đầu.
- **Cùng chiều:** người sau ở trong 0.5 đơn vị phía trước trên cùng cạnh + cùng hướng → giảm tốc, **tối thiểu 35%, không bao giờ dừng hẳn** (chồng nhẹ được chấp nhận hơn kẹt cứng).

**Giữ chỗ** (`reservations.ts`, mọi chỗ ghi theo `characterKey`):

| Tài nguyên | Số lượng | Lấy khi | Trả khi |
|---|---|---|---|
| Chỗ xem hàng | 5 / shop | Người đầu hàng qua **cổng cửa** (xem dưới) | Đi ra tới cửa ngoài |
| Ô chờ | 10 / shop, FIFO | **Mọi** lượt ghé đều đứng vào hàng trước nếu còn ô (hàng rỗng + cổng mở thì đứng ô 1 rồi vào ngay trong cùng bước) | Qua cổng, được chuyển sang chỗ xem hàng |

**Hàng chờ dài ngắn theo dữ liệu (yêu cầu của chủ bot 2026-10-23):** muốn shop đông người thì hàng dài, nên độ dài hàng chờ được ĐIỀU KHIỂN chứ không để tự hình thành.

- **Hai con số khác nhau, đừng trộn:**
  - `U_S` (server, `storeUsers`) = số user unique tạo link ở S ngày D trên **toàn bộ** dữ liệu — quyết định hàng **nên** dài bao nhiêu.
  - `E_S` (mô phỏng) = số nhân vật trong cảnh có ≥ 1 lượt ghé S — giới hạn hàng **có thể** dài bao nhiêu, vì chỉ người thật mới được xếp hàng.
  - Hai số chỉ lệch khi có > 30 người tạo link trong ngày D (người có link ngày D luôn được chọn vào cảnh trước, mục 3.3).
- **Mục tiêu:** `queueTarget(S) = shop đóng ? 0 : max(0, min(10, ceil(U_S / 2), E_S − 1))`. Chặn `E_S − 1` để hàng không bao giờ đòi giữ **tất cả** người đủ điều kiện (nếu không sẽ không ai được vào trừ khi hết `maxWait`). Chia đôi để vẫn còn người đi lại giữa 2 shop và trên đường. Ví dụ (E_S đủ lớn): U=0→0, 1→0 (E=1), 3→2, 6→3, 12→6, ≥19→10.
- **Cổng cửa** — người **đầu hàng** được vào khi và chỉ khi:
  ```
  hasFreeBrowseSpot && (queueLength >= queueTarget(S) || waited >= maxWait)
  ```
  `queueLength` tính CẢ người đầu hàng. `maxWait` = 20–25s (PRNG theo nhân vật). Hệ quả cố ý:
  - `queueTarget = 0` (shop vắng, 1 người, hoặc đóng cửa) → `0 >= 0` luôn đúng: vào ngay khi có chỗ, **không có thời gian chờ nhân tạo**.
  - `queueTarget = 10`, hàng đủ 10 → `10 >= 10` đúng: người đầu hàng vào ngay khi trong shop có chỗ, hàng giữ ở 9–10 người. Không còn ca chỉ vào được nhờ `maxWait`.
  - Shop đủ 5 người → cổng đóng bất kể độ dài hàng; không ai lọt vào thành người thứ 6.
  - Trong shop còn chỗ nhưng hàng chưa đạt mục tiêu → người đầu chờ thêm (để hàng dài lên) tối đa `maxWait`.
- **Trung thực:** hàng chờ shop S chỉ gồm nhân vật thật sự có lượt ghé S chưa diễn trong vòng hiện tại. Không có nhân vật "đóng thế" để làm hàng dài; mỗi người vẫn vào shop **đúng** `visits` lần mỗi vòng diễn. Shop chỉ 1–2 user thì hàng cũng chỉ 1–2 người, có lúc trống — đúng với dữ liệu.
- **Đưa người về hàng:** người còn lượt ghé S đi thẳng tới S sau khi xuất hiện / sau khi ra khỏi shop kia (không dạo xen giữa các lượt) để hàng có người.
- Hàng chờ FIFO: khi cổng mở, **người đầu hàng** lấy chỗ xem hàng ngay trong cùng bước; những người còn lại dồn lên 1 ô. Không ai được vượt hàng.
- Hết cả 10 ô → không chờ, đi dạo vòng ngắn (≈ 8–12 giây) rồi quay lại thử.
- `releaseAll(key)` được gọi ở mọi lối ra khỏi trạng thái có giữ chỗ (kể cả rời cảnh/huỷ) — không có chỗ "mồ côi".
- **Không deadlock / không đói:** chỉ có 2 loại tài nguyên, lấy theo thứ tự cố định (ô chờ → chỗ xem hàng); chỗ xem hàng luôn được trả sau thời gian hữu hạn; cổng cửa luôn mở cho người đầu hàng sau tối đa `maxWait` khi có chỗ; không có khoá cạnh; đi cùng chiều chỉ giảm tốc. Không thể có chu trình chờ, và mọi người trong hàng đều vào được sau thời gian hữu hạn.

## 7. Máy trạng thái + đạo diễn

```
OFFSTAGE ──(hết thời gian nghỉ)──► ENTER_SCENE (đi từ spawn)
  ├─ còn lượt ghé ──► GO_TO_STORE ──► (còn ô) QUEUED ──(cổng cửa mở)──► ENTER_STORE ──► BROWSE (1–2 kệ, 2–4s/kệ)
  │                      │                                                  ──► TAKE_BAG ──► EXIT_STORE
  │                      ├─ (hết ô) ► DETOUR_STROLL ──► GO_TO_STORE
  │                      └─ (shop đóng cửa) ► AT_SHUTTER (1.5s, quay đi, không túi) ──► lượt kế
  │    EXIT_STORE ──► còn lượt? GO_TO_STORE (lượt kế) : STROLL
  └─ hết lượt / không có lượt ──► STROLL (1 vòng; người 0 link: 1–3 vòng, có thể ngồi ghế) ──► LEAVE_SCENE ──► OFFSTAGE (5–15s)
```

- **Kịch bản = `visits`** theo đúng thứ tự thời gian thật; mỗi vòng diễn tiêu thụ danh sách **đúng 1 lần**, rời cảnh, nghỉ, rồi diễn lại từ đầu (túi reset). Người `visits = []` không bao giờ vào trạng thái nào liên quan tới shop.
- **Thời gian mô phỏng là thời gian nén** (≈ 12–18s/lượt), không liên quan giờ thật. Không gì trên trang (tóm tắt, bảng tin) đổi trong lúc diễn; trình duyệt không gửi request nào sau khi tải.
- **PRNG riêng mỗi nhân vật** (mulberry32 từ `seed`): tốc độ đi 0.9–1.15, thời gian xem hàng, thời điểm xuất hiện (0–20s lệch), số vòng dạo. Cùng dữ liệu → cùng diễn biến.
- **Khởi động ấm:** trước khung hình đầu, tua nhanh mô phỏng (bước cố định 1/30s) **tối thiểu 40s, rồi tiếp tục cho tới khi hàng chờ của mọi shop mở ≥ `queueTarget − 1`, tối đa 120s mô phỏng**. Điều kiện dừng tất định (cùng dữ liệu → cùng điểm dừng). 120s × 30 nhân vật × 30 bước/s = 108.000 bước cập nhật thuần, không vẽ — đo thời gian thật khi kiểm hiệu năng (mục tiêu < 150ms).
- **Delta time:** chuyển động nhân với dt; dt kẹp tối đa 0.1s.
- **Ẩn tab:** `visibilitychange` → dừng `requestAnimationFrame` và **đóng băng** đồng hồ mô phỏng. Hiện lại → đặt lại mốc thời gian, khung đầu dt = 0. Không tua bù, không phát hàng loạt sự kiện, không nhảy vị trí.

## 8. Chất lượng & hiệu năng

- **Mức chất lượng tự hạ (không tự nâng lại):** Cao (bloom, shadow 2048, pixelRatio ≤ 2) → Vừa (tắt bloom) → Thấp (shadow 1024, pixelRatio 1). Hạ một mức khi p95 thời gian khung hình > 28ms trong 3 cửa sổ 120 khung liên tiếp.
- **Cấu hình đo chuẩn:** Chrome stable trên MacBook của chủ bot (máy dev), cửa sổ 1440×900, DB giả 30 user (số lượt ghé 0–12, có cả 2 sàn), đo 60s sau khởi động ấm, ở mức Cao.
- **Mục tiêu:** FPS trung bình ≥ 50, p95 frame time ≤ 25ms, khung > 50ms ≤ 1%. Kèm 1 lần đo với CPU throttling 4× trong DevTools để xác nhận cơ chế tự hạ hoạt động.
- **Bundle:** đo và báo kích thước `public/store-scene.js` gốc + gzip sau build; không cam kết con số trước.

## 9. Kiểm thử

### Server (`src/core/__tests__/storeTraffic.test.ts`, `src/api/__tests__/adminStoreRoute.test.ts`)
1. Cắt ngày giờ VN: link 00:30 VN (= 17:30Z hôm trước) thuộc D; 23:59 VN thuộc D; 00:00 VN ngày D+1 không thuộc D.
2. Cửa sổ 7 ngày lịch: link ngày D−6 tính active, D−7 không; "hôm qua" lùi cả cửa sổ.
3. Xếp hạng 3 tầng, kể cả hoà ở cả 2 tầng đầu.
4. Nhiều link cùng timestamp: thứ tự theo rowid, ổn định.
5. User có nhiều link liên tiếp cùng một shop rồi link ở shop kia: `visits` đúng thứ tự.
6. Phân bổ mẫu: 30 user có seed trùng `mod 50` → không 2 người cùng mẫu; cùng dữ liệu → cùng mẫu.
7. 30 user được chọn nhưng chỉ vài người có link ngày D: phần còn lại `visits = []`, tóm tắt vẫn đúng.
8. Tóm tắt khớp bảng tin cùng ngày; bảng tin cắt ở 200 + `feedOverflow`.
9. Tên thiếu/rỗng → "Khách …xxxx"; avatar `javascript:`/có dấu nháy → `null`.
10. JSON nhúng không chứa `userId` của bất kỳ ai; tên chứa `</script><img onerror=…>` không phá trang (cả bảng tin lẫn JSON).
11. Route: chưa đăng nhập → redirect login; `?ngay=` lạ → hôm nay; TikTok tắt → `tiktokOpen=false`.
11a. `storeLinks` bằng đúng `summary.shopeeLinks/tiktokLinks` (đếm mọi user, kể cả người ngoài 30 nhân vật).
11b. `storeUsers`: 1 user tạo 10 link Shopee → đóng góp 1; user tạo link ở cả 2 sàn → được đếm ở cả 2; > 30 user có link ngày D → `storeUsers` vẫn đếm đủ, không bị giới hạn 30.

### Mô phỏng (`src/web/storeScene/sim/__tests__/*.test.ts`, tsx, không three)
12. Đồ thị liên thông; mọi đường tìm được chỉ dùng cạnh có thật; qua đường chỉ ở cạnh vạch.
13. Không điểm đi bộ nào nằm trong vùng bị toà nhà che theo hướng camera (test hình học trên footprint 2D chiếu theo hướng nhìn).
14. Không bao giờ > 5 người trong shop (chạy 30 nhân vật × 10 phút mô phỏng, kiểm mỗi bước).
15. Đủ 5 chỗ + 10 ô chờ: người thứ 16 đi vòng dạo, không ai chiếm trùng ô; FIFO đúng thứ tự.
15a. `queueTarget` (hàm thuần): (U=0,E=0)→0 · (U=1,E=1)→0 · (U=3,E=3)→2 · (U=12,E=12)→6 · (U=19,E=19)→10 · (U=30,E=30)→10 · (U=100,E=4)→3 · shop đóng → 0.
15b. U=1: người duy nhất vào shop **trong cùng bước** tới cửa khi có chỗ (thời gian chờ = 0).
15c. Hai shop U/E khác nhau — kịch bản cố định: 12 nhân vật mỗi người 3 lượt S, 3 nhân vật mỗi người 3 lượt T, 15 nhân vật 0 lượt (tổng 30). Đo mỗi giây trong 10 phút mô phỏng sau khởi động ấm: trung bình hàng S ≥ 0.7 × 6 = 4.2 người **và** ≥ trung bình hàng T + 2; hàng S không bao giờ > 10. Nếu không đạt thì chỉnh tham số nhịp (`maxWait`, thời gian xem hàng, thời gian nghỉ ngoài cảnh) chứ **không hạ ngưỡng**.
15d. U ≥ 19, hàng đủ 10: khi một chỗ trong shop được trả, người đầu hàng vào ngay trong cùng bước (không phải chờ `maxWait`).
15e. Shop đủ 5 người + hàng ≥ mục tiêu: cổng đóng, không ai thành người thứ 6.
15f. Trong shop có chỗ, hàng < mục tiêu: người đầu hàng vào được sau đúng `maxWait` (không kẹt mãi).
15g. Không khách giả: mọi nhân vật từng đứng trong hàng S đều có ≥ 1 lượt S trong `visits`; số lần vào S mỗi vòng diễn = số lượt S; một user nhiều link chỉ chiếm 1 ô tại một thời điểm.
15h. Nguồn đếm: dữ liệu có U_S = 40 nhưng cảnh chỉ có E_S = 8 → `queueTarget = 7` (lấy chặn `E_S − 1`), không phải 4 (tính theo E) cũng không phải 10 (tính theo U).
15i. Khởi động ấm dừng đúng điều kiện và tất định; không vượt 120s mô phỏng.
16. Nhân vật bị huỷ/rời cảnh khi đang giữ chỗ → chỗ được trả, người đầu hàng vào được.
17. Không deadlock: sau 10 phút mô phỏng mọi nhân vật đều đã hoàn thành ≥ 1 vòng diễn.
18. Thứ tự lượt ghé diễn ra đúng `visits`; người `visits = []` không bao giờ vào trạng thái liên quan shop.
19. Shop đóng: lượt TikTok → `AT_SHUTTER`, không túi, không chiếm chỗ.
20. Xác định: cùng dữ liệu + cùng chuỗi dt → cùng vị trí từng nhân vật.
21. Đóng băng: dừng đồng hồ rồi chạy lại với dt = 0 → không nhân vật nào đổi vị trí ở khung đầu.

### Kiểm bằng mắt (Chrome thật, server preview riêng + DB giả, không bật bot)
22. So với ảnh tham chiếu: bố cục, góc camera, màu, nhãn đọc được; chip ×N đọc được; bảng đếm trên 2 biển hiệu; hàng chờ shop đông đọc ra là một hàng dài (cách đều, không dồn cụm), không chắn vạch sang đường, không che mặt kính.
23. Đo hiệu năng theo mục 8; báo kích thước bundle.
24. Dự phòng: tắt WebGL (`--disable-webgl`) và chặn file bundle → thông báo hiện đúng, tóm tắt + bảng tin vẫn đủ.
25. Ẩn tab 30s rồi quay lại: không giật/nhảy.
26. Hôm qua có lượt TikTok + TikTok đang tắt: cửa cuốn, nhân vật đứng rồi quay đi.

## 10. Tiêu chí nghiệm thu

- Toàn bộ test mục 9 (1–21) xanh; `npm run typecheck` (cả 2 tsconfig) và `npm run build` sạch.
- Kiểm bằng mắt 22–26 đạt, có ảnh chụp.
- Hiệu năng đạt mục tiêu mục 8 trên cấu hình chuẩn, có số đo thật.
- Không ghi DB, không route/API JSON mới ngoài trang HTML sau `requireAdminAuth`.
- Tài liệu: tạo `.claude/rules/cua-hang-hom-nay.md`, thêm vào bản đồ `CLAUDE.md`, ghi ngoại lệ bundle client vào `admin-ui-nen-tang.md`.

## 11. Rủi ro / giả định còn lại

- **Chất lượng hình ảnh tự dựng** chỉ đạt khoảng 70–80% độ mịn của ảnh AI tham chiếu; sẽ chỉnh nhiều vòng bằng ảnh chụp.
- **Railway build:** giả định Railway chạy `npm run build` với devDependencies (đang đúng cho `@tailwindcss/cli`); `esbuild` đi cùng đường đó.
- **Khung 1280px** (sidebar chiếm chỗ) làm cảnh hẹp còn ~640px; chỉ cam kết đẹp ở ≥ 1440px.
- **Tên sản phẩm** chỉ có khi `COMMISSION_LOOKUP_ENABLED=true`.
