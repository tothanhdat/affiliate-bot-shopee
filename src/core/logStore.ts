import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import type { MerchantId } from "./merchants.js";
import type { LinkSourceContext, Platform, RequestLogEntry, RequestOutcome } from "./types.js";

/**
 * 3 field cuoi la OPTIONAL luc ghi (khac voi RequestLogEntry doc ra - o do chung luon la
 * `T | null`): phan lon cho goi record() khong co thong tin nay, va bat moi cho truyen `null`
 * tuong minh chi them nhieu chu chu khong them an toan nao.
 */
export type RecordRequestInput = Omit<
  RequestLogEntry,
  "id" | "timestamp" | "productName" | "commissionEstimate" | "sourceContext"
> &
  Partial<Pick<RequestLogEntry, "timestamp" | "productName" | "commissionEstimate" | "sourceContext">>;

export interface CreatedLinkFilters {
  /** Khop MOT PHAN user_id / product_name / original_url / sub_id (va user nam trong `searchUserKeys`). */
  search?: string;
  /**
   * Khoa "platform:userId" cua cac user co TEN HIEN THI khop `search` (2026-10-10). Ten nam o DB khac
   * (user_profiles) nen caller tu tra roi truyen xuong - chi co tac dung khi `search` co gia tri.
   * Truyen qua MOT tham so json_each chu khong phai `IN (?,?,...)`: tim "a" co the khop hang tram user,
   * khong duoc cham gioi han so bien cua SQLite.
   */
  searchUserKeys?: string[];
  platform?: Platform;
  /** undefined = lay ca luot thanh cong lan luot loi. */
  outcome?: RequestOutcome;
  /** Khop CHINH XAC - dung khi bam tu /admin/users sang, khong duoc keo theo user co id chua chuoi tuong tu. */
  userId?: string;
  /**
   * Khoang thoi gian theo GIO VN, CA HAI dau deu tinh vao. Bo trong 1 dau = khong gioi han dau do.
   * Nhan 2 dang: "YYYY-MM-DD" (ca ngay: tu 00:00 / den het 23:59) hoac "YYYY-MM-DDTHH:mm" (2026-10-10,
   * dang cua <input type="datetime-local">): "tu" tinh tu giay :00 cua phut do, "den" tinh HET phut do
   * (ke ca giay :59) - chon "den 23:59" phai giu luot luc 23:59:30.
   */
  fromDate?: string;
  toDate?: string;
}

export interface CreatedLinksTotals {
  total: number;
  success: number;
  errors: number;
  distinctUsers: number;
  /** Tong hoa hong GOC uoc tinh cua cac luot THANH CONG trong pham vi bo loc. */
  commissionEstimateTotal: number;
}

/** `%`/`_` nguoi dung go phai escape, neu khong thi go "1_2" se khop ca "132". */
function likePattern(raw: string): string {
  return `%${raw.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/**
 * Cat ngay theo GIO VN. `timestamp` luu ISO UTC, ma Railway chay UTC: 01:30 ngay 02/10 gio VN la
 * 18:30 ngay 01/10 UTC, nen loc thang tren chuoi UTC se day luot do sang nham ngay hom truoc suot
 * 7 tieng moi ngay. Giong DAY_EXPR cua ledgerStore de 2 trang doi chieu duoc voi nhau.
 */
const VN_DAY_EXPR = "date(timestamp, '+7 hours')";

/**
 * Thoi diem cua luot, doi sang gio VN, dang "YYYY-MM-DD HH:MM:SS" (da cat phan le giay). So sanh voi
 * moc cung dang nay - sap xep chuoi dung thu tu thoi gian, va khong phu thuoc timestamp luu co phan
 * ms/"Z" hay khong. KHONG so sanh thang tren chuoi ISO: "...00Z" > "...00.000Z" theo tu dien.
 */
const VN_DATETIME_EXPR = "datetime(timestamp, '+7 hours')";

/** Dau khoang -> moc "YYYY-MM-DD HH:MM:SS" gio VN. Chi ngay thi "tu" = 00:00:00, "den" = 23:59:59. */
function vnBound(value: string, edge: "from" | "to"): string {
  if (value.length === 10) return `${value} ${edge === "from" ? "00:00:00" : "23:59:59"}`;
  return `${value.replace("T", " ")}:${edge === "from" ? "00" : "59"}`;
}

function buildCreatedLinksWhere(filters?: CreatedLinkFilters): {
  where: string;
  params: (string | number)[];
} {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters?.platform) {
    conditions.push("platform = ?");
    params.push(filters.platform);
  }
  if (filters?.outcome) {
    conditions.push("outcome = ?");
    params.push(filters.outcome);
  }
  if (filters?.userId) {
    conditions.push("user_id = ?");
    params.push(filters.userId);
  }
  // So sanh truc tiep tren chuoi "YYYY-MM-DD HH:MM:SS" gio VN - dinh dang nay sap xep tu dien trung
  // sap xep thoi gian. `datetime()` cat phan le giay nen "den HH:mm:59" gom ca luot luc HH:mm:59.999.
  if (filters?.fromDate) {
    conditions.push(`${VN_DATETIME_EXPR} >= ?`);
    params.push(vnBound(filters.fromDate, "from"));
  }
  if (filters?.toDate) {
    conditions.push(`${VN_DATETIME_EXPR} <= ?`);
    params.push(vnBound(filters.toDate, "to"));
  }
  const search = filters?.search?.trim();
  if (search) {
    const byName = filters?.searchUserKeys && filters.searchUserKeys.length > 0;
    conditions.push(
      `(user_id LIKE ? ESCAPE '\\' OR product_name LIKE ? ESCAPE '\\' OR original_url LIKE ? ESCAPE '\\' OR sub_id LIKE ? ESCAPE '\\'${
        byName ? " OR (platform || ':' || user_id) IN (SELECT value FROM json_each(?))" : ""
      })`
    );
    const pattern = likePattern(search);
    params.push(pattern, pattern, pattern, pattern);
    if (byName) params.push(JSON.stringify(filters.searchUserKeys));
  }

  return { where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "", params };
}

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
    this.migrateAddLinkDetailColumns();
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

  /**
   * 3 cot cho trang /admin/links (2026-10-08). Nullable, khong DEFAULT, KHONG backfill:
   * - product_name/commission_estimate: tra lai hom nay se ra hoa hong HOM NAY, khong phai so da
   *   bao cho user luc tao link -> ghi vao la pha huy chinh thu dung de doi soat (cung ly do
   *   order_date cua ledgerStore khong backfill duoc).
   * - source_context: platform khong suy ra duoc group/DM.
   * Row cu de null va trang admin hien "—".
   */
  private migrateAddLinkDetailColumns(): void {
    const columns = this.db.prepare("PRAGMA table_info(requests)").all() as Array<{ name: string }>;
    const existing = new Set(columns.map((col) => col.name));
    const toAdd: Array<[string, string]> = [
      ["product_name", "TEXT"],
      ["commission_estimate", "INTEGER"],
      ["source_context", "TEXT"],
    ];
    for (const [name, type] of toAdd) {
      if (!existing.has(name)) {
        this.db.exec(`ALTER TABLE requests ADD COLUMN ${name} ${type}`);
      }
    }
  }

  record(entry: RecordRequestInput): RequestLogEntry {
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
      productName: entry.productName ?? null,
      // ?? chu KHONG dung || : commissionEstimate = 0 la gia tri THAT ("chua bat hoa hong"),
      // || se bien no thanh null va trang admin se noi sai ve san pham do.
      commissionEstimate: entry.commissionEstimate ?? null,
      sourceContext: entry.sourceContext ?? null,
    };

    this.db
      .prepare(
        `INSERT INTO requests
          (id, timestamp, platform, merchant, user_id, original_url, sub_id, outcome, error_code,
           affiliate_url, product_name, commission_estimate, source_context)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        full.affiliateUrl,
        full.productName,
        full.commissionEstimate,
        full.sourceContext
      );

    return full;
  }

  // ===========================================================================
  // Trang /admin/links (2026-10-08) - liet ke MOI luot tao link, ke ca luot loi.
  // 3 ham duoi dung CHUNG buildCreatedLinksWhere(): lech bo loc la so trang khong khop so dong
  // va the KPI noi mot so trong khi bang liet ke so khac (bay da gap o listCommissionEntries).
  // ===========================================================================

  listCreatedLinks(
    filters?: CreatedLinkFilters,
    paging?: { limit: number; offset: number }
  ): RequestLogEntry[] {
    const { where, params } = buildCreatedLinksWhere(filters);
    // Tiebreak rowid DESC: timestamp chi phan giai toi mili-giay, ma 1 tin nhan nhieu link se ghi
    // nhieu row trong cung mili-giay - thieu no thi trang 1 va trang 2 co the trung/sot dong.
    let sql = `SELECT * FROM requests ${where} ORDER BY timestamp DESC, rowid DESC`;
    const args = [...params];
    if (paging) {
      sql += " LIMIT ? OFFSET ?";
      args.push(paging.limit, paging.offset);
    }
    return this.db
      .prepare(sql)
      .all(...args)
      .map(rowToEntry);
  }

  countCreatedLinks(filters?: CreatedLinkFilters): number {
    const { where, params } = buildCreatedLinksWhere(filters);
    const row = this.db
      .prepare(`SELECT COUNT(*) AS total FROM requests ${where}`)
      .get(...params) as { total: number };
    return row.total;
  }

  /** So lieu cho 4 the KPI dau trang /admin/links - tinh tren DUNG bo loc dang ap dung. */
  getCreatedLinksTotals(filters?: CreatedLinkFilters): CreatedLinksTotals {
    const { where, params } = buildCreatedLinksWhere(filters);
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END), 0) AS success,
           COALESCE(SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END), 0) AS errors,
           COUNT(DISTINCT platform || ':' || user_id) AS distinct_users,
           -- Chi cong luot THANH CONG: luot loi khong tao ra link nao nen khoan hoa hong do khong
           -- bao gio ton tai, cong vao se bao cao vuot thuc te.
           COALESCE(SUM(CASE WHEN outcome = 'success' THEN commission_estimate ELSE 0 END), 0)
             AS commission_estimate_total
         FROM requests ${where}`
      )
      .get(...params) as Record<string, number>;
    return {
      total: row.total,
      success: row.success,
      errors: row.errors,
      distinctUsers: row.distinct_users,
      commissionEstimateTotal: row.commission_estimate_total,
    };
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

  // ===========================================================================
  // Tong hop cho trang /admin/dashboard (2026-10-01) - do SUC KHOE cua bot (co ai dung khong, co
  // loi khong), doc lap hoan toan voi viec da import bao cao hoa hong hay chua.
  //
  // timestamp luu ISO UTC nen phai +7 gio truoc khi cat lay ngay, de khop voi cach cat ngay cua
  // ledgerStore (xem DAY_EXPR o do) - 2 chart canh nhau ma lech mui gio thi khong doi chieu duoc.
  // ===========================================================================

  countRequestsByDayAndOutcome(
    fromKey: string,
    toKey: string
  ): Array<{ day: string; outcome: RequestOutcome; count: number }> {
    const rows = this.db
      .prepare(
        `SELECT date(timestamp, '+7 hours') AS day, outcome, COUNT(*) AS count
         FROM requests
         WHERE date(timestamp, '+7 hours') BETWEEN ? AND ?
         GROUP BY day, outcome`
      )
      .all(fromKey, toKey) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      day: r.day as string,
      outcome: r.outcome as RequestOutcome,
      count: r.count as number,
    }));
  }

  getRequestTotals(
    fromKey: string,
    toKey: string
  ): { total: number; success: number; activeUsers: number } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END), 0) AS success,
           COUNT(DISTINCT platform || ':' || user_id) AS active_users
         FROM requests
         WHERE date(timestamp, '+7 hours') BETWEEN ? AND ?`
      )
      .get(fromKey, toKey) as Record<string, number>;
    return { total: row.total, success: row.success, activeUsers: row.active_users };
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
    productName: (r.product_name as string | null) ?? null,
    // ?? chu khong || : 0 la gia tri THAT ("san pham chua bat hoa hong"), xem commissionLookup.ts.
    commissionEstimate: (r.commission_estimate as number | null) ?? null,
    sourceContext: (r.source_context as LinkSourceContext | null) ?? null,
  };
}
