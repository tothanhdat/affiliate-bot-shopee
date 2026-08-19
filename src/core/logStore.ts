import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import type { MerchantId } from "./merchants.js";
import type { Platform, RequestLogEntry, RequestOutcome } from "./types.js";

const SHORT_LINK_CODE_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const SHORT_LINK_CODE_LENGTH = 7;

function randomShortLinkCode(): string {
  const bytes = randomBytes(SHORT_LINK_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < SHORT_LINK_CODE_LENGTH; i++) {
    code += SHORT_LINK_CODE_ALPHABET[bytes[i] % SHORT_LINK_CODE_ALPHABET.length];
  }
  return code;
}

export class LogStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") {
      mkdirSync(dirname(databasePath), { recursive: true });
    }
    this.db = new DatabaseSync(databasePath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS requests (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        platform TEXT NOT NULL,
        merchant TEXT,
        user_id TEXT NOT NULL,
        original_url TEXT NOT NULL,
        sub_id TEXT,
        outcome TEXT NOT NULL,
        error_code TEXT,
        affiliate_url TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp);
      CREATE INDEX IF NOT EXISTS idx_requests_platform ON requests(platform);
    `);
    // Phai chay TRUOC khi tao index tren cot merchant - DB tao truoc khi co field nay se
    // chua thieu cot, va CREATE INDEX se loi "no such column" neu chay truoc migration.
    this.migrateAddMerchantColumn();
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_requests_merchant ON requests(merchant);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_requests_sub_id ON requests(sub_id);`);

    // short_links: T3.2 - rut gon link an_redir tu build (Shopee Direct, dai ~150-290+ ky tu)
    // thanh "{DASHBOARD_BASE_URL}/s/{code}", dung chung DB voi requests (khong phai du lieu
    // tai chinh nen khong can tach rieng nhu ledger.db). code KHONG doan duoc (base62 ngau nhien
    // tu randomBytes), nhung day KHONG phai co che bao mat - chi la rut gon hien thi, target_url
    // van la link cong khai (an_redir) khong chua thong tin nhay cam.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS short_links (
        code TEXT PRIMARY KEY,
        target_url TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  /**
   * Tao 1 short link moi tro toi targetUrl, tra ve code. Retry vai lan neu trung code (xac suat
   * cuc thap voi 7 ky tu base62 nhung khong loai tru hoan toan, khong dua vao may man).
   */
  createShortLink(targetUrl: string): string {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomShortLinkCode();
      try {
        this.db
          .prepare(`INSERT INTO short_links (code, target_url, created_at) VALUES (?, ?, ?)`)
          .run(code, targetUrl, new Date().toISOString());
        return code;
      } catch (err) {
        if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) continue;
        throw err;
      }
    }
    throw new Error("Khong the tao short link code duy nhat sau nhieu lan thu");
  }

  /** Dung boi route GET /s/:code de redirect that (302) - tra null neu code khong ton tai. */
  resolveShortLink(code: string): string | null {
    const row = this.db.prepare(`SELECT target_url FROM short_links WHERE code = ?`).get(code) as
      | { target_url: string }
      | undefined;
    return row ? row.target_url : null;
  }

  /** DB tao truoc khi co field merchant se thieu cot nay - them vao neu chua co, khong mat du lieu cu. */
  private migrateAddMerchantColumn(): void {
    const columns = this.db.prepare("PRAGMA table_info(requests)").all() as Array<{ name: string }>;
    const hasMerchantColumn = columns.some((col) => col.name === "merchant");
    if (!hasMerchantColumn) {
      this.db.exec("ALTER TABLE requests ADD COLUMN merchant TEXT");
    }
  }

  record(entry: Omit<RequestLogEntry, "id" | "timestamp"> & { timestamp?: string }): RequestLogEntry {
    const full: RequestLogEntry = {
      id: randomUUID(),
      timestamp: entry.timestamp ?? new Date().toISOString(),
      platform: entry.platform,
      merchant: entry.merchant,
      userId: entry.userId,
      originalUrl: entry.originalUrl,
      subId: entry.subId,
      outcome: entry.outcome,
      errorCode: entry.errorCode,
      affiliateUrl: entry.affiliateUrl,
    };

    this.db
      .prepare(
        `INSERT INTO requests
          (id, timestamp, platform, merchant, user_id, original_url, sub_id, outcome, error_code, affiliate_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        full.id,
        full.timestamp,
        full.platform,
        full.merchant,
        full.userId,
        full.originalUrl,
        full.subId,
        full.outcome,
        full.errorCode,
        full.affiliateUrl
      );

    return full;
  }

  /** Lay log theo khoang ngay (ISO date, vi du "2026-07-31"), loc theo platform/merchant neu co. */
  queryByDateRange(
    fromDateInclusive: string,
    toDateInclusive: string,
    platform?: Platform,
    merchant?: MerchantId
  ): RequestLogEntry[] {
    const from = `${fromDateInclusive}T00:00:00.000Z`;
    const to = `${toDateInclusive}T23:59:59.999Z`;

    const conditions = ["timestamp BETWEEN ? AND ?"];
    const params: (string | number)[] = [from, to];
    if (platform) {
      conditions.push("platform = ?");
      params.push(platform);
    }
    if (merchant) {
      conditions.push("merchant = ?");
      params.push(merchant);
    }

    const rows = this.db
      .prepare(`SELECT * FROM requests WHERE ${conditions.join(" AND ")} ORDER BY timestamp DESC`)
      .all(...params);

    return rows.map(rowToEntry);
  }

  /** Dung boi ledgerAdmin.ts de suy ra platform/userId/merchant tu 1 subId da ghi log truoc do. */
  findBySubId(subId: string): RequestLogEntry | null {
    const rows = this.db
      .prepare(`SELECT * FROM requests WHERE sub_id = ? ORDER BY timestamp DESC LIMIT 1`)
      .all(subId);
    return rows.length > 0 ? rowToEntry(rows[0]) : null;
  }

  close(): void {
    this.db.close();
  }
}

function rowToEntry(row: unknown): RequestLogEntry {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as string,
    timestamp: r.timestamp as string,
    platform: r.platform as Platform,
    merchant: (r.merchant as MerchantId | null) ?? null,
    userId: r.user_id as string,
    originalUrl: r.original_url as string,
    subId: (r.sub_id as string | null) ?? null,
    outcome: r.outcome as RequestOutcome,
    errorCode: (r.error_code as string | null) ?? null,
    affiliateUrl: (r.affiliate_url as string | null) ?? null,
  };
}
