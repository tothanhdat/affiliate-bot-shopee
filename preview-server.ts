import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "./src/api/server.js";
import { AdminSessionStore } from "./src/core/adminAuth.js";
import { LedgerStore } from "./src/core/ledgerStore.js";
import { LogStore } from "./src/core/logStore.js";
import { LinkResolverService } from "./src/core/linkResolverService.js";
import { RateLimiter } from "./src/core/rateLimiter.js";
import { MockAffiliateProvider } from "./src/core/providers/mockProvider.js";

const dir = mkdtempSync(join(tmpdir(), "preview-"));
const logStore = new LogStore(join(dir, "requests.db"));
const ledgerStore = new LedgerStore(join(dir, "ledger.db"));
const resolver = new LinkResolverService(new MockAffiliateProvider(), logStore, new RateLimiter(1000, 60_000));
const orderConfig = { taxPercent: 10, platformFeePercent: 1, userSharePercent: 80, maxCommissionRatioPercent: 1000, holdConfig: { thresholdVnd: 0, holdDays: 0 } };
const rec = (orderId: string, userId: string, commission: number, status: "pending" | "confirmed", orderDate: string | null, orderTime: string | null) =>
  ledgerStore.recordConversion({
    subId: `k-${userId}-x`, platform: "zalo", userId, merchant: "shopee", orderId, orderDate, orderTime,
    orderAmount: commission * 10, commissionAmount: commission, taxPercent: 10, platformFeePercent: 1, userSharePercent: 80,
    productName: `San pham mau ${orderId}`, maxCommissionRatioPercent: 1000, holdConfig: { thresholdVnd: 0, holdDays: 0 }, status,
  });
rec("260928AAA001", "u1", 40_000, "pending", "2026-09-28", "21:15:42"); // co ngay + gio
rec("260928AAA002", "u2", 60_000, "pending", "2026-10-02", null); // chi co ngay (chua duoc bu gio)
rec("260928AAA003", "u1", 25_000, "confirmed", null, null); // don cu: khong co ngay dat
const app = createServer(resolver, logStore, ledgerStore, async () => {}, 50_000, new AdminSessionStore("preview"), orderConfig, join(dir, "proofs"), new RateLimiter(1000, 60_000), "http://localhost:3099", async () => {}, async () => {}, false, async () => {});
app.listen(3099, () => console.log("preview http://localhost:3099/admin/orders  (mat khau: preview)"));
