import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { computeCommissionBreakdown } from "./commissionMath.js";
import {
  DuplicateConversionError,
  EntryAlreadyWithdrawnError,
  EntryNotPendingError,
  ImplausibleCommissionAmountError,
  InsufficientBalanceError,
  MissingBankInfoError,
  WithdrawalAlreadyPendingError,
} from "./errors.js";
import type { MerchantId } from "./merchants.js";
import { SETTINGS_KEYS } from "./settingsKeys.js";
import { normalizeNewlines } from "./textNormalize.js";
import type {
  CommissionEntry,
  CommissionStatus,
  DashboardToken,
  ImportActionType,
  FaqMuteReason,
  ImportHistoryEntry,
  Platform,
  StatusTransition,
  WithdrawalRequest,
  ZaloGroup,
} from "./types.js";
import { resolveUserSharePercent } from "./userCommissionOverride.js";
import type { UserCommissionOverride } from "./userCommissionOverride.js";

/**
 * Bieu thuc SQL cho "ngay cua 1 don" theo gio VN. order_date da la ngay VN san (doc tu bao cao
 * Shopee) nen dung thang; created_at luu ISO UTC nen phai +7 gio TRUOC khi cat lay ngay - thieu
 * buoc nay thi don tao tu 00:00 den 07:00 gio VN bi dem sang ngay hom truoc.
 */
const DAY_EXPR = "COALESCE(order_date, date(created_at, '+7 hours'))";

/**
 * Bo 3 ty le dung de chia hoa hong 1 don. Truyen vao updatePendingEntry/confirmPendingEntry duoi vai
 * FALLBACK: chi dung cho entry ghi truoc khi he thong chot ty le theo tung don (xem
 * CommissionEntry.userSharePercent), entry moi luon dung ty le da chot trong DB.
 */
export interface RatePercents {
  taxPercent: number;
  platformFeePercent: number;
  userSharePercent: number;
}

export interface RecordConversionInput {
  subId: string;
  platform: Platform;
  userId: string;
  merchant: MerchantId;
  orderId: string;
  /** Ten san pham - tuy chon, dien them de hien thi ro tren dashboard */
  productName?: string;
  orderAmount: number;
  /** Hoa hong goc (100%) tu affiliate network, TRUOC khi tru thue/phi */
  commissionAmount: number;
  /** % thue tren commissionAmount, tru truoc tien */
  taxPercent: number;
  /** % phi san, tinh tren phan DA TRU THUE (khong phai tren commissionAmount goc) */
  platformFeePercent: number;
  /** % user duoc nhan tren phan DA TRU THUE VA PHI */
  userSharePercent: number;
  /**
   * Nguong hop ly cua commissionAmount so voi orderAmount (%) - vuot qua nguong nay bi tu choi
   * ngay (ImplausibleCommissionAmountError), chan loi go nham (vd them 1 so 0) luc nhap tay.
   * Hoa hong affiliate that thuong chi vai % - vai chuc %, khong bao gio gan/vuot gia tri don hang.
   */
  maxCommissionRatioPercent: number;
  /**
   * Ngay user DAT don that, dang "YYYY-MM-DD" theo gio VN (tu cot "Thời Gian Đặt Hàng" cua bao cao
   * Shopee). null khi nguon khong cho biet (ghi don le bang tay, bao cao cu khong co cot nay) - luc
   * do moi thong ke se tu lui ve created_at. KHONG bao gio doan ngay.
   */
  orderDate?: string | null;
  status?: CommissionStatus;
  note?: string;
}

export interface UserLedgerSummary {
  entries: CommissionEntry[];
  availableBalance: number;
  pendingBalance: number;
  paidTotal: number;
}

/** Bo loc dung chung boi listCommissionEntries() va countCommissionEntries() (trang /admin/orders). */
export interface CommissionEntryFilters {
  platform?: Platform;
  userId?: string;
  merchant?: MerchantId;
  /** Nhieu trang thai cung luc (form admin dung checkbox). Rong/undefined = khong loc theo trang thai. */
  statuses?: CommissionStatus[];
  /**
   * O tim kiem 1 dong cua /admin/orders (2026-10-04): khop MOT PHAN ma don, userId, hoac ten hien thi.
   * Khac `userId` o tren - cai do khop CHINH XAC va duoc dung khi admin bam tu /admin/users sang, con
   * cai nay la admin tu go vao o tim. Giu ca 2 vi 2 muc dich khac nhau: bam tu /admin/users phai ra
   * DUNG user do, khong duoc keo theo user khac co userId chua chuoi tuong tu.
   */
  search?: string;
}

/**
 * Chuan bi 1 chuoi nguoi dung go thanh toan hang `LIKE`.
 *
 * BAT BUOC escape `%` va `_` - do la wildcard cua LIKE, de nguyen thi go "%" se khop MOI don (vo
 * nghia nhung khong sai) con go "1_2" se khop ca "132" (sai that). Ky tu escape la `\` nen ban than
 * `\` cung phai nhan doi, va moi menh de LIKE dung chuoi nay PHAI kem `ESCAPE '\'`.
 *
 * Luu y da biet: LIKE cua SQLite chi khong phan biet hoa/thuong voi ASCII, nen go "thao" khong khop
 * "Thảo". Chap nhan duoc vi cong dung chinh cua o tim la ma don (toan chu in + so).
 */
function likePattern(raw: string): string {
  return `%${raw.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/**
 * Dung menh de WHERE dung chung cho listCommissionEntries/countCommissionEntries/getOrdersFilterTotals -
 * 3 ham nay BAT BUOC phai loc y het nhau, neu khong thi tong so trang va cac the KPI dau trang se
 * khong khop voi so don that su hien ra trong bang.
 */
function buildCommissionEntriesWhere(filters?: CommissionEntryFilters): { where: string; params: (string | number)[] } {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (filters?.platform) {
    conditions.push("platform = ?");
    params.push(filters.platform);
  }
  if (filters?.userId) {
    conditions.push("user_id = ?");
    params.push(filters.userId);
  }
  if (filters?.merchant) {
    conditions.push("merchant = ?");
    params.push(filters.merchant);
  }
  if (filters?.statuses && filters.statuses.length > 0) {
    conditions.push(`status IN (${filters.statuses.map(() => "?").join(", ")})`);
    params.push(...filters.statuses);
  }
  const search = filters?.search?.trim();
  if (search) {
    // Ten hien thi nam o bang KHAC (user_profiles) nen phai di qua subquery tuong quan thay vi JOIN:
    // JOIN se nhan ban dong neu 1 user co nhieu ho so, va lam LEFT JOIN thi phai sua ca 3 ham dung
    // menh de nay. EXISTS giu nguyen hinh dang "FROM commission_entries <where>" cua ca 3.
    conditions.push(
      `(order_id LIKE ? ESCAPE '\\' OR user_id LIKE ? ESCAPE '\\' OR EXISTS (
         SELECT 1 FROM user_profiles p
         WHERE p.platform = commission_entries.platform
           AND p.user_id = commission_entries.user_id
           AND p.display_name LIKE ? ESCAPE '\\'
       ))`
    );
    const pattern = likePattern(search);
    params.push(pattern, pattern, pattern);
  }
  return { where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "", params };
}

/** So lieu cho 4 the KPI dau trang /admin/orders - xem getOrdersFilterTotals(). */
export interface OrdersFilterTotals {
  /** Tong so don khop bo loc (dung luon lam co so tinh so trang). */
  totalEntries: number;
  /** So don dang "pending" TRONG pham vi bo loc - loc status=confirmed thi so nay la 0, dung nhu vay. */
  pendingEntries: number;
  /** Tong tien user nhan, KHONG tinh don da huy. */
  userShareTotal: number;
  /** Tong phan con lai cua chu bot (sau thue/phi san), KHONG tinh don da huy. */
  ownerShareTotal: number;
}

export class LedgerStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") {
      mkdirSync(dirname(databasePath), { recursive: true });
    }
    this.db = new DatabaseSync(databasePath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS commission_entries (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        platform TEXT NOT NULL,
        user_id TEXT NOT NULL,
        merchant TEXT NOT NULL,
        sub_id TEXT NOT NULL,
        order_id TEXT NOT NULL,
        product_name TEXT,
        order_amount INTEGER NOT NULL,
        commission_amount INTEGER NOT NULL,
        tax_amount INTEGER NOT NULL,
        platform_fee_amount INTEGER NOT NULL,
        after_tax_amount INTEGER NOT NULL,
        user_share_amount INTEGER NOT NULL,
        tax_percent REAL,
        platform_fee_percent REAL,
        user_share_percent REAL,
        status TEXT NOT NULL,
        withdrawal_id TEXT,
        note TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_commission_entries_order ON commission_entries(merchant, order_id);
      CREATE INDEX IF NOT EXISTS idx_commission_entries_user ON commission_entries(platform, user_id);
      CREATE INDEX IF NOT EXISTS idx_commission_entries_withdrawal ON commission_entries(withdrawal_id);
    `);
    // DB tao truoc khi co buoc tru thue/phi (2026-08-17) se thieu 3 cot nay - them vao neu chua co,
    // khong mat du lieu cu. Dung DEFAULT 0 vi cac entry cu khong co du lieu thue/phi that.
    this.migrateAddTaxColumns();
    // DB tao truoc 2026-10-01 (truoc khi doc cot ngay dat don cua bao cao Shopee) se thieu cot nay.
    this.migrateAddOrderDateColumn();
    // DB tao truoc 2026-10-01 (truoc khi ty le duoc CHOT theo tung don) se thieu 3 cot nay.
    this.migrateAddRatePercentColumns();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS withdrawal_requests (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        paid_at TEXT,
        platform TEXT NOT NULL,
        user_id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        status TEXT NOT NULL,
        proof_image_path TEXT,
        bank_name TEXT NOT NULL DEFAULT '',
        bank_account_number TEXT NOT NULL DEFAULT '',
        bank_account_holder TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user ON withdrawal_requests(platform, user_id);
      CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status ON withdrawal_requests(status);

      CREATE TABLE IF NOT EXISTS dashboard_tokens (
        token TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_tokens_user ON dashboard_tokens(platform, user_id);

      CREATE TABLE IF NOT EXISTS user_profiles (
        platform TEXT NOT NULL,
        user_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (platform, user_id)
      );

      -- % hoa hong RIENG cho 1 user, co han su dung (2026-10-01). Bang MOI nen khong can migration.
      -- 1 dong = 1 user (khong luu lich su cac uu dai cu: lich su that nam o cot user_share_percent
      -- cua tung don trong commission_entries, da chot vinh vien tai do).
      -- end_date NULL = khong han. start_date = ngay admin bam Luu, xem userCommissionOverride.ts.
      CREATE TABLE IF NOT EXISTS user_commission_overrides (
        platform TEXT NOT NULL,
        user_id TEXT NOT NULL,
        user_share_percent REAL NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (platform, user_id)
      );

      CREATE TABLE IF NOT EXISTS welcome_messages (
        platform TEXT NOT NULL,
        user_id TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        PRIMARY KEY (platform, user_id)
      );

      CREATE TABLE IF NOT EXISTS group_join_messages (
        platform TEXT NOT NULL,
        user_id TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        PRIMARY KEY (platform, user_id)
      );

      CREATE TABLE IF NOT EXISTS zalo_groups (
        group_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        notify_enabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS faq_thread_mutes (
        platform TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        muted_until INTEGER,
        reason TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (platform, thread_id)
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS import_history (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        action_type TEXT NOT NULL,
        new_order_ids TEXT NOT NULL,
        status_transitions TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_import_history_created ON import_history(created_at);
    `);
    this.migrateCreateSeenOrdersTable();
    this.fixSeenOrdersBeforeEntryCreated();
    this.migrateCreateOrderStatusEventsTable();
    // DB tao truoc khi co yeu cau dinh kem bang chung chuyen khoan (2026-08-19) se thieu cot nay.
    this.migrateAddWithdrawalProofColumn();
    // DB tao truoc khi co form ngan hang bat buoc (2026-08-20) se thieu 3 cot nay.
    this.migrateAddBankInfoColumns();
  }

  /**
   * imported_orders (2026-10-06): moi ma don DUOC BAO CAO SHOPEE NHAC TOI LAN DAU, kem trang thai
   * luc do va NGAY IMPORT (gio VN) - nguon cua chart "Don hang moi moi ngay" tren /admin/dashboard.
   * Bang RIENG voi commission_entries vi don MOI ma da huy ngay tu lan dau KHONG bao gio duoc ghi
   * vao commission_entries (importShopeeReport bo qua - khong co tien de chia), nhung van phai dem
   * la "don moi", va phai nho la da dem de lan import sau (bao cao liet ke lai ca lich su) khong
   * dem lai lan nua. PRIMARY KEY (merchant, order_id) + INSERT OR IGNORE = chi lan DAU thang.
   *
   * Backfill 1 lan luc bang vua duoc tao, tu import_history (newOrderIds cua cac lan import "csv"):
   * ngay = ngay import that, nhung trang thai CHI biet trang thai HIEN TAI cua entry (khong con
   * ban ghi trang thai luc import) va don huy-ngay-tu-dau khong the khoi phuc - chap nhan duoc.
   */
  private migrateCreateSeenOrdersTable(): void {
    const existed = this.db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'imported_orders'")
      .get();
    if (existed) return;
    this.db.exec(`
      CREATE TABLE imported_orders (
        merchant TEXT NOT NULL,
        order_id TEXT NOT NULL,
        status TEXT NOT NULL,
        import_day TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (merchant, order_id)
      );
      CREATE INDEX idx_imported_orders_day ON imported_orders(import_day);
    `);
    const history = this.db
      .prepare("SELECT created_at, new_order_ids FROM import_history WHERE action_type = 'csv' ORDER BY created_at ASC")
      .all() as Array<{ created_at: string; new_order_ids: string }>;
    const findEntry = this.db.prepare("SELECT merchant, status FROM commission_entries WHERE order_id = ?");
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO imported_orders (merchant, order_id, status, import_day, created_at) VALUES (?, ?, ?, ?, ?)"
    );
    for (const h of history) {
      const importDay = new Date(new Date(h.created_at).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
      for (const orderId of JSON.parse(h.new_order_ids) as string[]) {
        const entry = findEntry.get(orderId) as { merchant: string; status: string } | undefined;
        if (!entry) continue;
        insert.run(entry.merchant, orderId, entry.status === "paid" ? "confirmed" : entry.status, importDay, h.created_at);
      }
    }
  }

  /**
   * Chot an toan chay MOI lan khoi dong (idempotent): 1 don khong the "lan dau thay khi import" SAU
   * ngay no da nam trong commission_entries. Ban dau tien cua imported_orders (2026-10-06) chi backfill
   * tu import_history, nen don ghi qua CLI / form "Ghi 1 don le" / import truoc 2026-08-23 se bi dem
   * nham la "don moi" o lan import ke tiep. Keo import_day ve ngay entry duoc ghi (gio VN).
   */
  private fixSeenOrdersBeforeEntryCreated(): void {
    this.db.exec(`
      UPDATE imported_orders
      SET import_day = (
        SELECT date(MIN(e.created_at), '+7 hours') FROM commission_entries e
        WHERE e.merchant = imported_orders.merchant AND e.order_id = imported_orders.order_id
      )
      WHERE import_day > (
        SELECT date(MIN(e.created_at), '+7 hours') FROM commission_entries e
        WHERE e.merchant = imported_orders.merchant AND e.order_id = imported_orders.order_id
      )
    `);
  }

  /**
   * order_status_events (2026-10-07): moi don CHUYEN sang "confirmed" (Kha dung) hoac "reversed" (Da
   * huy) duoc ghi DUNG 1 LAN cho moi trang thai, vao ngay import ghi nhan no - nguon cua 2 cot "Chuyen
   * Kha dung" / "Da huy" tren chart dashboard. Gom ca don MOI ma da o trang thai do ngay lan dau (don
   * hoa toc -> Kha dung, don huy ngay -> Da huy). PRIMARY KEY (merchant, order_id, to_status) + INSERT
   * OR IGNORE: bao cao Shopee liet ke lai lich su nen don da huy hom qua se lai hien "Da huy" hom nay,
   * va KHONG duoc dem lai cho hom nay (yeu cau user).
   *
   * Backfill 1 lan luc tao bang: truoc tu statusTransitions cua import_history (ngay that), sau do tu
   * imported_orders co trang thai confirmed/reversed (ngay lan dau thay) - INSERT OR IGNORE nen
   * chuyen trang thai that duoc uu tien.
   */
  private migrateCreateOrderStatusEventsTable(): void {
    const existed = this.db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'order_status_events'")
      .get();
    if (existed) return;
    this.db.exec(`
      CREATE TABLE order_status_events (
        merchant TEXT NOT NULL,
        order_id TEXT NOT NULL,
        to_status TEXT NOT NULL,
        event_day TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (merchant, order_id, to_status)
      );
      CREATE INDEX idx_order_status_events_day ON order_status_events(event_day);
    `);
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO order_status_events (merchant, order_id, to_status, event_day, created_at) VALUES (?, ?, ?, ?, ?)"
    );
    const findMerchant = this.db.prepare("SELECT merchant FROM commission_entries WHERE order_id = ?");
    const history = this.db
      .prepare("SELECT created_at, status_transitions FROM import_history WHERE action_type = 'csv' ORDER BY created_at ASC")
      .all() as Array<{ created_at: string; status_transitions: string }>;
    for (const h of history) {
      const day = new Date(new Date(h.created_at).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
      for (const t of JSON.parse(h.status_transitions) as StatusTransition[]) {
        if (t.to !== "confirmed" && t.to !== "reversed") continue;
        const entry = findMerchant.get(t.orderId) as { merchant: string } | undefined;
        if (!entry) continue;
        insert.run(entry.merchant, t.orderId, t.to, day, h.created_at);
      }
    }
    this.db.exec(`
      INSERT OR IGNORE INTO order_status_events (merchant, order_id, to_status, event_day, created_at)
      SELECT merchant, order_id, status, import_day, created_at FROM imported_orders
      WHERE status IN ('confirmed', 'reversed')
    `);
  }

  /** Ghi 1 lan don chuyen sang confirmed/reversed. Tra false neu don nay da tung duoc ghi trang thai do. */
  recordOrderStatusEvent(
    merchant: string,
    orderId: string,
    toStatus: "confirmed" | "reversed",
    eventDay: string
  ): boolean {
    const result = this.db
      .prepare(
        "INSERT OR IGNORE INTO order_status_events (merchant, order_id, to_status, event_day, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(merchant, orderId, toStatus, eventDay, new Date().toISOString());
    return Number(result.changes) > 0;
  }

  /** So don chuyen sang confirmed/reversed theo ngay import - 2 cot con lai cua chart "Don hang moi". */
  countOrderStatusEventsByDay(
    fromKey: string,
    toKey: string
  ): Array<{ day: string; toStatus: "confirmed" | "reversed"; count: number }> {
    const rows = this.db
      .prepare(
        `SELECT event_day AS day, to_status, COUNT(*) AS count
         FROM order_status_events
         WHERE event_day BETWEEN ? AND ?
         GROUP BY event_day, to_status`
      )
      .all(fromKey, toKey) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      day: r.day as string,
      toStatus: r.to_status as "confirmed" | "reversed",
      count: r.count as number,
    }));
  }

  /**
   * Ghi nhan 1 don Shopee vua xuat hien trong bao cao import. Tra true neu day la LAN DAU he thong
   * thay ma don nay (don moi that su), false neu da thay roi - lan sau khong doi trang thai/ngay.
   */
  recordSeenOrder(
    merchant: string,
    orderId: string,
    status: "pending" | "confirmed" | "reversed",
    importDay: string
  ): boolean {
    const result = this.db
      .prepare(
        "INSERT OR IGNORE INTO imported_orders (merchant, order_id, status, import_day, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(merchant, orderId, status, importDay, new Date().toISOString());
    return Number(result.changes) > 0;
  }

  /** So don MOI theo ngay import va trang thai LUC IMPORT - du lieu chart "Don hang moi moi ngay". */
  countSeenOrdersByDayAndStatus(
    fromKey: string,
    toKey: string
  ): Array<{ day: string; status: "pending" | "confirmed" | "reversed"; count: number }> {
    const rows = this.db
      .prepare(
        `SELECT import_day AS day, status, COUNT(*) AS count
         FROM imported_orders
         WHERE import_day BETWEEN ? AND ?
         GROUP BY import_day, status`
      )
      .all(fromKey, toKey) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      day: r.day as string,
      status: r.status as "pending" | "confirmed" | "reversed",
      count: r.count as number,
    }));
  }

  /**
   * DB tao truoc 2026-10-01 (truoc khi trang /admin/dashboard can ngay dat don that) se thieu cot
   * nay. KHONG backfill duoc: bao cao Shopee da import xong khong con luu lai o dau, nen entry cu
   * de NULL va moi thong ke tu lui ve created_at qua COALESCE (xem dashboardStats.ts).
   */
  private migrateAddOrderDateColumn(): void {
    const columns = this.db.prepare("PRAGMA table_info(commission_entries)").all() as Array<{
      name: string;
    }>;
    if (!columns.some((col) => col.name === "order_date")) {
      this.db.exec("ALTER TABLE commission_entries ADD COLUMN order_date TEXT");
    }
  }

  /**
   * DB tao truoc 2026-10-01 (truoc khi ty le duoc CHOT theo tung don, xem CommissionEntry.userSharePercent)
   * se thieu 3 cot nay. Nullable CO CHU DICH - khong dat DEFAULT va khong backfill: ty le that luc ghi
   * nhan don cu khong con luu o dau, va suy nguoc tu so tien thi sai khi hoa hong nho. Entry cu de NULL
   * -> luc tinh lai se lui ve ty le hien hanh, dung bang hanh vi truoc khi co tinh nang nay.
   */
  private migrateAddRatePercentColumns(): void {
    const columns = this.db.prepare("PRAGMA table_info(commission_entries)").all() as Array<{
      name: string;
    }>;
    const hasColumn = (name: string) => columns.some((col) => col.name === name);

    if (!hasColumn("tax_percent")) {
      this.db.exec("ALTER TABLE commission_entries ADD COLUMN tax_percent REAL");
    }
    if (!hasColumn("platform_fee_percent")) {
      this.db.exec("ALTER TABLE commission_entries ADD COLUMN platform_fee_percent REAL");
    }
    if (!hasColumn("user_share_percent")) {
      this.db.exec("ALTER TABLE commission_entries ADD COLUMN user_share_percent REAL");
    }
  }

  /** DB tao truoc 2026-08-19 (truoc khi bat buoc dinh kem anh chuyen khoan) se thieu cot nay. */
  private migrateAddWithdrawalProofColumn(): void {
    const columns = this.db.prepare("PRAGMA table_info(withdrawal_requests)").all() as Array<{
      name: string;
    }>;
    if (!columns.some((col) => col.name === "proof_image_path")) {
      this.db.exec("ALTER TABLE withdrawal_requests ADD COLUMN proof_image_path TEXT");
    }
  }

  /**
   * DB tao truoc 2026-08-20 (truoc khi bat buoc form ngan hang luc gui yeu cau rut, xem
   * phan-hoi-cai-thien-trai-nghiem-nguoi-dung.md muc 9) se thieu 3 cot nay. Dung DEFAULT '' cho du
   * lieu cu (cac yeu cau rut da ghi truoc do khong co thong tin ngan hang that).
   */
  private migrateAddBankInfoColumns(): void {
    const columns = this.db.prepare("PRAGMA table_info(withdrawal_requests)").all() as Array<{
      name: string;
    }>;
    const hasColumn = (name: string) => columns.some((col) => col.name === name);
    if (!hasColumn("bank_name")) {
      this.db.exec("ALTER TABLE withdrawal_requests ADD COLUMN bank_name TEXT NOT NULL DEFAULT ''");
    }
    if (!hasColumn("bank_account_number")) {
      this.db.exec("ALTER TABLE withdrawal_requests ADD COLUMN bank_account_number TEXT NOT NULL DEFAULT ''");
    }
    if (!hasColumn("bank_account_holder")) {
      this.db.exec("ALTER TABLE withdrawal_requests ADD COLUMN bank_account_holder TEXT NOT NULL DEFAULT ''");
    }
  }

  /** DB tao truoc 2026-08-17 (truoc khi co buoc tru thue/phi) se thieu 3 cot nay - them vao neu chua co. */
  private migrateAddTaxColumns(): void {
    const columns = this.db.prepare("PRAGMA table_info(commission_entries)").all() as Array<{
      name: string;
    }>;
    const hasColumn = (name: string) => columns.some((col) => col.name === name);

    if (!hasColumn("tax_amount")) {
      this.db.exec("ALTER TABLE commission_entries ADD COLUMN tax_amount INTEGER NOT NULL DEFAULT 0");
    }
    if (!hasColumn("platform_fee_amount")) {
      this.db.exec(
        "ALTER TABLE commission_entries ADD COLUMN platform_fee_amount INTEGER NOT NULL DEFAULT 0"
      );
    }
    if (!hasColumn("after_tax_amount")) {
      // Default = commission_amount cho du lieu cu (coi nhu chua tru gi), khong the tinh lai chinh xac
      // vi khong biet ty le thue/phi ap dung luc do.
      this.db.exec(
        "ALTER TABLE commission_entries ADD COLUMN after_tax_amount INTEGER NOT NULL DEFAULT 0"
      );
      this.db.exec("UPDATE commission_entries SET after_tax_amount = commission_amount WHERE after_tax_amount = 0");
    }
    if (!hasColumn("product_name")) {
      this.db.exec("ALTER TABLE commission_entries ADD COLUMN product_name TEXT");
    }
  }

  /**
   * Ghi 1 don hang da xac nhan (dung boi ledgerAdmin.ts, xem T2.1 trong spec cho huong tu dong hoa sau nay).
   * Thu tu tru: thue tinh tren commissionAmount goc -> phi san tinh tren phan DA TRU THUE (khong phai
   * tren commissionAmount goc) -> userShareAmount tinh tren phan con lai sau ca thue va phi.
   * Thu tu nay tham khao theo cach 1 bot doi thu hien thi (thue truoc, phi san tren phan da tru thue).
   */
  recordConversion(input: RecordConversionInput): CommissionEntry {
    const maxPlausibleCommission = (input.orderAmount * input.maxCommissionRatioPercent) / 100;
    if (input.commissionAmount > maxPlausibleCommission) {
      throw new ImplausibleCommissionAmountError(
        input.commissionAmount,
        input.orderAmount,
        input.maxCommissionRatioPercent
      );
    }

    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const status: CommissionStatus = input.status ?? "confirmed";

    const { taxAmount, platformFeeAmount, afterTaxAmount, userShareAmount } = computeCommissionBreakdown({
      commissionAmount: input.commissionAmount,
      taxPercent: input.taxPercent,
      platformFeePercent: input.platformFeePercent,
      userSharePercent: input.userSharePercent,
    });

    try {
      this.db
        .prepare(
          `INSERT INTO commission_entries
            (id, created_at, order_date, platform, user_id, merchant, sub_id, order_id, product_name, order_amount, commission_amount, tax_amount, platform_fee_amount, after_tax_amount, user_share_amount, tax_percent, platform_fee_percent, user_share_percent, status, withdrawal_id, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
        )
        .run(
          id,
          createdAt,
          input.orderDate ?? null,
          input.platform,
          input.userId,
          input.merchant,
          input.subId,
          input.orderId,
          input.productName ?? null,
          input.orderAmount,
          input.commissionAmount,
          taxAmount,
          platformFeeAmount,
          afterTaxAmount,
          userShareAmount,
          // 3 ty le duoc CHOT tai day va khong bao gio ghi de - moi lan tinh lai tien cho don nay
          // deu doc lai 3 so nay (xem effectivePercents()).
          input.taxPercent,
          input.platformFeePercent,
          input.userSharePercent,
          status,
          input.note ?? null
        );
    } catch (err) {
      if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
        throw new DuplicateConversionError(input.orderId);
      }
      throw err;
    }

    return {
      id,
      createdAt,
      orderDate: input.orderDate ?? null,
      platform: input.platform,
      userId: input.userId,
      merchant: input.merchant,
      subId: input.subId,
      orderId: input.orderId,
      productName: input.productName ?? null,
      orderAmount: input.orderAmount,
      commissionAmount: input.commissionAmount,
      taxAmount,
      platformFeeAmount,
      afterTaxAmount,
      userShareAmount,
      taxPercent: input.taxPercent,
      platformFeePercent: input.platformFeePercent,
      userSharePercent: input.userSharePercent,
      status,
      withdrawalId: null,
      note: input.note ?? null,
      proofImagePath: null,
    };
  }

  /**
   * Cap nhat lai order_amount/commission_amount (va thue/phi/userShare tinh lai theo) cho 1 entry
   * VAN CON "pending" (2026-08-21, phat hien qua bao cao thuc te: nguon affiliate tra ve commission=0
   * luc giao dich con hold, roi dien dan so lieu uoc tinh that len dashboard cua ho TRUOC KHI duyet
   * hang - nhung sync cu bo qua hoan toan entry da ton tai bat ke trang thai gi, nen dashboard cua
   * bot ket qua bi "dong bang" o 0d cho toi khi don duoc duyet). KHONG doi status (van "pending"), chi cap nhat so
   * lieu hien thi - khac confirmPendingEntry (doi status sang "confirmed").
   */
  updatePendingEntry(
    entryId: string,
    input: {
      orderAmount: number;
      commissionAmount: number;
      productName?: string | null;
      fallbackPercents: RatePercents;
      maxCommissionRatioPercent: number;
    }
  ): CommissionEntry {
    const row = this.db.prepare(`SELECT * FROM commission_entries WHERE id = ?`).get(entryId);
    if (!row) {
      throw new Error(`Khong tim thay commission entry voi id "${entryId}"`);
    }
    const existing = rowToCommissionEntry(row);

    const maxPlausibleCommission = (input.orderAmount * input.maxCommissionRatioPercent) / 100;
    if (input.commissionAmount > maxPlausibleCommission) {
      throw new ImplausibleCommissionAmountError(
        input.commissionAmount,
        input.orderAmount,
        input.maxCommissionRatioPercent
      );
    }

    const percents = effectivePercents(existing, input.fallbackPercents);
    const { taxAmount, platformFeeAmount, afterTaxAmount, userShareAmount } = computeCommissionBreakdown({
      commissionAmount: input.commissionAmount,
      ...percents,
    });
    const productName = input.productName ?? existing.productName;

    this.db
      .prepare(
        `UPDATE commission_entries SET order_amount = ?, commission_amount = ?,
          tax_amount = ?, platform_fee_amount = ?, after_tax_amount = ?, user_share_amount = ?,
          tax_percent = ?, platform_fee_percent = ?, user_share_percent = ?, product_name = ?
         WHERE id = ?`
      )
      .run(
        input.orderAmount,
        input.commissionAmount,
        taxAmount,
        platformFeeAmount,
        afterTaxAmount,
        userShareAmount,
        // Ghi lai ty le VUA DUNG: voi entry da co ty le chot thi day la ghi de chinh no (vo hai),
        // voi entry cu (null) thi day la lan CHOT dau tien - tu lan import sau no khong con troi
        // theo % hien hanh nua.
        percents.taxPercent,
        percents.platformFeePercent,
        percents.userSharePercent,
        productName,
        entryId
      );

    return {
      ...existing,
      orderAmount: input.orderAmount,
      commissionAmount: input.commissionAmount,
      taxAmount,
      platformFeeAmount,
      afterTaxAmount,
      userShareAmount,
      ...percents,
      productName,
    };
  }

  /**
   * Chuyen 1 entry dang "pending" (bao cao Shopee ghi "Dang cho xu ly"/"Chua thanh toan", xem
   * shopeeReportImport.ts) sang "confirmed" khi bao cao sau do ghi "Hoan thanh" -
   * UPDATE tai cho thay vi INSERT moi, vi INSERT se dung UNIQUE constraint (merchant, order_id)
   * da co san tu luc con pending (DuplicateConversionError). Tinh lai thue/phi/userShare tu
   * commissionAmount/orderAmount MOI NHAT trong bao cao luc duyet - co the khac nhe so voi
   * luc con hold (hiem nhung co the xay ra), khong tin so lieu cu.
   */
  confirmPendingEntry(
    entryId: string,
    input: {
      orderAmount: number;
      commissionAmount: number;
      productName?: string | null;
      fallbackPercents: RatePercents;
      maxCommissionRatioPercent: number;
    }
  ): CommissionEntry {
    const row = this.db.prepare(`SELECT * FROM commission_entries WHERE id = ?`).get(entryId);
    if (!row) {
      throw new Error(`Khong tim thay commission entry voi id "${entryId}"`);
    }
    const existing = rowToCommissionEntry(row);

    const maxPlausibleCommission = (input.orderAmount * input.maxCommissionRatioPercent) / 100;
    if (input.commissionAmount > maxPlausibleCommission) {
      throw new ImplausibleCommissionAmountError(
        input.commissionAmount,
        input.orderAmount,
        input.maxCommissionRatioPercent
      );
    }

    const percents = effectivePercents(existing, input.fallbackPercents);
    const { taxAmount, platformFeeAmount, afterTaxAmount, userShareAmount } = computeCommissionBreakdown({
      commissionAmount: input.commissionAmount,
      ...percents,
    });
    const productName = input.productName ?? existing.productName;

    this.db
      .prepare(
        `UPDATE commission_entries SET status = 'confirmed', order_amount = ?, commission_amount = ?,
          tax_amount = ?, platform_fee_amount = ?, after_tax_amount = ?, user_share_amount = ?,
          tax_percent = ?, platform_fee_percent = ?, user_share_percent = ?, product_name = ?
         WHERE id = ?`
      )
      .run(
        input.orderAmount,
        input.commissionAmount,
        taxAmount,
        platformFeeAmount,
        afterTaxAmount,
        userShareAmount,
        percents.taxPercent,
        percents.platformFeePercent,
        percents.userSharePercent,
        productName,
        entryId
      );

    return {
      ...existing,
      status: "confirmed",
      orderAmount: input.orderAmount,
      commissionAmount: input.commissionAmount,
      taxAmount,
      platformFeeAmount,
      afterTaxAmount,
      userShareAmount,
      ...percents,
      productName,
    };
  }

  /** Tong hoa hong da xac nhan, CHUA bi giu boi 1 yeu cau rut tien nao (kha dung de rut). */
  getAvailableBalance(platform: Platform, userId: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(user_share_amount), 0) AS total FROM commission_entries
         WHERE platform = ? AND user_id = ? AND status = 'confirmed' AND withdrawal_id IS NULL`
      )
      .get(platform, userId) as { total: number };
    return row.total;
  }

  /** Danh sach entries + cac tong, dung cho dashboard ca nhan. */
  getUserSummary(platform: Platform, userId: string): UserLedgerSummary {
    // LEFT JOIN withdrawal_requests de lay proof_image_path (bang chung da chuyen khoan) cho cac
    // entry "paid" - user xem duoc anh admin da dinh kem luc "Danh dau da tra" ngay tren dashboard.
    const rows = this.db
      .prepare(
        `SELECT ce.*, wr.proof_image_path AS withdrawal_proof_image_path
         FROM commission_entries ce
         LEFT JOIN withdrawal_requests wr ON ce.withdrawal_id = wr.id
         WHERE ce.platform = ? AND ce.user_id = ?
         ORDER BY ce.created_at DESC`
      )
      .all(platform, userId);
    const entries = rows.map(rowToCommissionEntry);

    const pendingRow = this.db
      .prepare(
        `SELECT COALESCE(SUM(user_share_amount), 0) AS total FROM commission_entries
         WHERE platform = ? AND user_id = ? AND status = 'confirmed' AND withdrawal_id IS NOT NULL`
      )
      .get(platform, userId) as { total: number };

    const paidRow = this.db
      .prepare(
        `SELECT COALESCE(SUM(user_share_amount), 0) AS total FROM commission_entries
         WHERE platform = ? AND user_id = ? AND status = 'paid'`
      )
      .get(platform, userId) as { total: number };

    return {
      entries,
      availableBalance: this.getAvailableBalance(platform, userId),
      pendingBalance: pendingRow.total,
      paidTotal: paidRow.total,
    };
  }

  /**
   * Ghi/cap nhat ten hien thi cua 1 user (lay tu ctx.from cua Telegram hoac message.data.dName cua
   * Zalo, goi moi khi bot nhan duoc tin nhan) - chi de admin de nhan dien, khong dung de tinh toan.
   * Bo qua neu displayName rong (khong ghi de ten da biet bang chuoi rong).
   */
  upsertUserProfile(platform: Platform, userId: string, displayName: string): void {
    const trimmed = displayName.trim();
    if (trimmed === "") return;

    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO user_profiles (platform, user_id, display_name, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(platform, user_id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`
      )
      .run(platform, userId, trimmed, updatedAt);
  }

  /**
   * "Claim" gui DM chao mung cho 1 user LAN DAU tien (2026-08-20, yeu cau truc tiep cua user) -
   * dung INSERT (khong phai SELECT roi INSERT rieng) de tranh race neu 2 tin nhan dau tien cua
   * cung 1 user den gan nhau cung luc (Zalo adapter khong await tuan tu tung handler, xem ghi
   * chu trong zalo/bot.ts). Tra ve true CHI o lan goi DAU TIEN (INSERT thanh cong) - goi lai voi
   * cung (platform,userId) tra ve false (UNIQUE constraint) va KHONG duoc gui DM nua.
   */
  tryClaimWelcomeMessage(platform: Platform, userId: string): boolean {
    try {
      this.db
        .prepare(`INSERT INTO welcome_messages (platform, user_id, sent_at) VALUES (?, ?, ?)`)
        .run(platform, userId, new Date().toISOString());
      return true;
    } catch (err) {
      if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
        return false;
      }
      throw err;
    }
  }

  /**
   * Claim-once cho DM chao mung LUC user vua duoc ADD vao group (2026-09-07) - bang RIENG voi
   * welcome_messages (khac trigger: welcome_messages la luc gui link san pham dau tien) thay vi
   * them cot phan loai vao bang cu, de khong phai doi PRIMARY KEY cua 1 bang da co du lieu that
   * tren production. Cung pattern INSERT-roi-catch UNIQUE nhu tryClaimWelcomeMessage o tren.
   */
  tryClaimGroupJoinMessage(platform: Platform, userId: string): boolean {
    try {
      this.db
        .prepare(`INSERT INTO group_join_messages (platform, user_id, sent_at) VALUES (?, ?, ?)`)
        .run(platform, userId, new Date().toISOString());
      return true;
    } catch (err) {
      if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
        return false;
      }
      throw err;
    }
  }

  /**
   * Ghi nhan 1 group Zalo bot dang o (2026-09-11) - goi tu zalo/bot.ts khi dong bo danh sach group
   * luc dang nhap va khi thay tin nhan tu group chua biet. Giu nguyen `notify_enabled` neu group da
   * ton tai: day la lua chon cua ADMIN tren /admin/settings, dong bo lai danh sach group khong duoc
   * lam mat no. Ten rong ("" - khi getGroupInfo that bai hoac khong tra ve ten) cung khong ghi de
   * ten da biet truoc do, de danh sach tren trang admin khong bi trong ten sau 1 lan goi API loi.
   */
  upsertZaloGroup(groupId: string, name: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO zalo_groups (group_id, name, notify_enabled, created_at, last_seen_at)
         VALUES (?, ?, 0, ?, ?)
         ON CONFLICT(group_id) DO UPDATE SET
           name = CASE WHEN excluded.name = '' THEN zalo_groups.name ELSE excluded.name END,
           last_seen_at = excluded.last_seen_at`
      )
      .run(groupId, name, now, now);
  }

  /** Dung boi zalo/bot.ts de chi goi getGroupInfo (1 request mang) cho group chua tung thay. */
  hasZaloGroup(groupId: string): boolean {
    const row = this.db.prepare(`SELECT 1 FROM zalo_groups WHERE group_id = ?`).get(groupId);
    return row !== undefined;
  }

  /** Toan bo group da biet (cho form checkbox tren /admin/settings) - sap theo ten cho de tim. */
  listZaloGroups(): ZaloGroup[] {
    const rows = this.db
      .prepare(`SELECT group_id, name, notify_enabled, created_at, last_seen_at FROM zalo_groups ORDER BY name, group_id`)
      .all() as Array<{
      group_id: string;
      name: string;
      notify_enabled: number;
      created_at: string;
      last_seen_at: string;
    }>;
    return rows.map(mapZaloGroupRow);
  }

  /** Cac group admin da tick - dung boi POST /admin/record-orders/shopee-report de gui thong bao. */
  listNotifyEnabledZaloGroups(): ZaloGroup[] {
    const rows = this.db
      .prepare(
        `SELECT group_id, name, notify_enabled, created_at, last_seen_at FROM zalo_groups
         WHERE notify_enabled = 1 ORDER BY name, group_id`
      )
      .all() as Array<{
      group_id: string;
      name: string;
      notify_enabled: number;
      created_at: string;
      last_seen_at: string;
    }>;
    return rows.map(mapZaloGroupRow);
  }

  /**
   * Luu lai TOAN BO lua chon tu form checkbox: bat dung cac group_id duoc tick, tat tat ca phan con
   * lai (form HTML khong gui ve checkbox bi bo tick, nen khong the suy ra "group nao vua bi tat" -
   * phai ghi lai ca danh sach). group_id la (vd group bot da roi khoi) khong tao dong moi: UPDATE
   * chi tac dong len dong da ton tai.
   */
  setZaloGroupNotifySelection(groupIds: string[]): void {
    this.db.exec(`UPDATE zalo_groups SET notify_enabled = 0`);
    const stmt = this.db.prepare(`UPDATE zalo_groups SET notify_enabled = 1 WHERE group_id = ?`);
    for (const groupId of groupIds) {
      stmt.run(groupId);
    }
  }

  /**
   * Khoa FAQ cho 1 thread (2026-09-13). mutedUntilMs = null nghia la khoa VO THOI HAN (lenh /im cua
   * admin); truyen epoch ms de khoa co han (admin vua go tay, hoac bot khong hieu cau hoi).
   * Luu DB chu khong giu trong RAM: deploy/restart khong duoc lam bot "tinh day noi leo" giua luc
   * admin dang tu van user.
   */
  muteFaqThread(platform: string, threadId: string, mutedUntilMs: number | null, reason: FaqMuteReason): void {
    this.db
      .prepare(
        `INSERT INTO faq_thread_mutes (platform, thread_id, muted_until, reason, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(platform, thread_id) DO UPDATE SET
           muted_until = excluded.muted_until,
           reason = excluded.reason,
           updated_at = excluded.updated_at`
      )
      .run(platform, threadId, mutedUntilMs, reason, Date.now());
  }

  unmuteFaqThread(platform: string, threadId: string): void {
    this.db.prepare(`DELETE FROM faq_thread_mutes WHERE platform = ? AND thread_id = ?`).run(platform, threadId);
  }

  /** muted_until NULL = vo thoi han; con lai so sanh voi nowMs (truyen vao de test duoc moc thoi gian). */
  isFaqThreadMuted(platform: string, threadId: string, nowMs: number): boolean {
    const row = this.db
      .prepare(`SELECT muted_until FROM faq_thread_mutes WHERE platform = ? AND thread_id = ?`)
      .get(platform, threadId) as { muted_until: number | null } | undefined;
    if (row === undefined) return false;
    if (row.muted_until === null) return true;
    return row.muted_until > nowMs;
  }

  /** Dung boi dashboard ca nhan (GET /d/:token) de hien ten hien thi + userId - tra 1 user, khong can load ca bang nhu getDisplayNamesMap(). */
  getDisplayName(platform: Platform, userId: string): string | null {
    const row = this.db
      .prepare(`SELECT display_name FROM user_profiles WHERE platform = ? AND user_id = ?`)
      .get(platform, userId) as { display_name: string } | undefined;
    return row ? row.display_name : null;
  }

  /** Dung boi trang admin (withdrawals/orders) de tra cuu ten hien thi theo key "platform:userId". */
  getDisplayNamesMap(): Map<string, string> {
    const rows = this.db.prepare(`SELECT platform, user_id, display_name FROM user_profiles`).all() as Array<{
      platform: Platform;
      user_id: string;
      display_name: string;
    }>;
    const map = new Map<string, string>();
    for (const r of rows) {
      map.set(`${r.platform}:${r.user_id}`, r.display_name);
    }
    return map;
  }

  /** Tong hop theo tung user, dung cho trang admin /admin/users. Sap xep theo so du kha dung giam dan. */
  listUsers(): Array<{
    platform: Platform;
    userId: string;
    displayName: string | null;
    availableBalance: number;
    pendingBalance: number;
    paidTotal: number;
    ordersCount: number;
    /** % hoa hong rieng dang cau hinh cho user nay, null neu dung % chung. */
    commissionOverride: UserCommissionOverride | null;
  }> {
    const rows = this.db
      .prepare(
        `SELECT ce.platform AS platform, ce.user_id AS user_id, up.display_name AS display_name,
            COALESCE(SUM(CASE WHEN ce.status = 'confirmed' AND ce.withdrawal_id IS NULL THEN ce.user_share_amount ELSE 0 END), 0) AS available,
            COALESCE(SUM(CASE WHEN ce.status = 'confirmed' AND ce.withdrawal_id IS NOT NULL THEN ce.user_share_amount ELSE 0 END), 0) AS pending,
            COALESCE(SUM(CASE WHEN ce.status = 'paid' THEN ce.user_share_amount ELSE 0 END), 0) AS paid,
            COUNT(*) AS orders_count,
            uco.user_share_percent AS override_percent,
            uco.start_date AS override_start_date,
            uco.end_date AS override_end_date,
            uco.updated_at AS override_updated_at
         FROM commission_entries ce
         LEFT JOIN user_profiles up ON up.platform = ce.platform AND up.user_id = ce.user_id
         LEFT JOIN user_commission_overrides uco ON uco.platform = ce.platform AND uco.user_id = ce.user_id
         GROUP BY ce.platform, ce.user_id
         ORDER BY available DESC`
      )
      .all() as Array<{
      platform: Platform;
      user_id: string;
      display_name: string | null;
      available: number;
      pending: number;
      paid: number;
      orders_count: number;
      override_percent: number | null;
      override_start_date: string | null;
      override_end_date: string | null;
      override_updated_at: string | null;
    }>;

    return rows.map((r) => ({
      platform: r.platform,
      userId: r.user_id,
      displayName: r.display_name,
      availableBalance: r.available,
      pendingBalance: r.pending,
      paidTotal: r.paid,
      ordersCount: r.orders_count,
      // override_percent CO THE la 0 (chu bot giu toan bo) - phai kiem tra null, khong dung falsy.
      commissionOverride:
        r.override_percent === null || r.override_start_date === null
          ? null
          : {
              platform: r.platform,
              userId: r.user_id,
              userSharePercent: r.override_percent,
              startDate: r.override_start_date,
              endDate: r.override_end_date,
              updatedAt: r.override_updated_at ?? "",
            },
    }));
  }

  /**
   * Ghi/ghi de % hoa hong rieng cua 1 user. startDate do caller truyen (= hom nay gio VN luc admin
   * bam Luu) chu khong tu lay new Date() o day, de route va test chot duoc moc thoi gian.
   */
  setUserCommissionOverride(input: {
    platform: Platform;
    userId: string;
    userSharePercent: number;
    startDate: string;
    endDate: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO user_commission_overrides
          (platform, user_id, user_share_percent, start_date, end_date, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(platform, user_id) DO UPDATE SET
           user_share_percent = excluded.user_share_percent,
           start_date = excluded.start_date,
           end_date = excluded.end_date,
           updated_at = excluded.updated_at`
      )
      .run(
        input.platform,
        input.userId,
        input.userSharePercent,
        input.startDate,
        input.endDate,
        new Date().toISOString()
      );
  }

  getUserCommissionOverride(platform: Platform, userId: string): UserCommissionOverride | null {
    const row = this.db
      .prepare(`SELECT * FROM user_commission_overrides WHERE platform = ? AND user_id = ?`)
      .get(platform, userId) as
      | {
          platform: Platform;
          user_id: string;
          user_share_percent: number;
          start_date: string;
          end_date: string | null;
          updated_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      platform: row.platform,
      userId: row.user_id,
      userSharePercent: row.user_share_percent,
      startDate: row.start_date,
      endDate: row.end_date ?? null,
      updatedAt: row.updated_at,
    };
  }

  /** Tra user ve % chung. Khong loi neu user chua tung co override. */
  deleteUserCommissionOverride(platform: Platform, userId: string): void {
    this.db
      .prepare(`DELETE FROM user_commission_overrides WHERE platform = ? AND user_id = ?`)
      .run(platform, userId);
  }

  listUserCommissionOverrides(): UserCommissionOverride[] {
    const rows = this.db
      .prepare(`SELECT * FROM user_commission_overrides ORDER BY updated_at DESC`)
      .all() as Array<{
      platform: Platform;
      user_id: string;
      user_share_percent: number;
      start_date: string;
      end_date: string | null;
      updated_at: string;
    }>;
    return rows.map((r) => ({
      platform: r.platform,
      userId: r.user_id,
      userSharePercent: r.user_share_percent,
      startDate: r.start_date,
      endDate: r.end_date ?? null,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * % user nhan cho 1 don DAT vao ngay `orderDateVn` ("YYYY-MM-DD" gio VN): % rieng neu con han,
   * khong thi `generalPercent` do caller truyen (= % chung hien hanh trong settings).
   * Goi tai dung thoi diem ghi nhan don - sau do ty le duoc CHOT vao entry, xem recordConversion.
   */
  resolveUserSharePercent(
    platform: Platform,
    userId: string,
    orderDateVn: string,
    generalPercent: number
  ): number {
    return resolveUserSharePercent(this.getUserCommissionOverride(platform, userId), generalPercent, orderDateVn);
  }

  /**
   * Danh sach don hang cho trang admin /admin/orders, loc tuy chon.
   * Truyen paging (limit/offset) de lay 1 trang; khong truyen thi tra ve TAT CA ban ghi khop bo loc
   * (2026-09-22: bo gioi han cung 300 ban ghi cu, vi trang web gio phan trang 50 don/trang nen
   * khong con tai ca danh sach mot luc nua - xem countCommissionEntries de biet tong so trang).
   */
  listCommissionEntries(filters?: CommissionEntryFilters, paging?: { limit: number; offset: number }): CommissionEntry[] {
    const { where, params } = buildCommissionEntriesWhere(filters);
    // Tiebreak rowid DESC: created_at chi phan giai toi mili-giay nen nhieu don ghi cung luc
    // (vd 1 lan import bao cao Shopee) co thu tu KHONG on dinh neu chi sap theo created_at -
    // phan trang se bi trung/sot don giua cac trang. Giong listImportHistory().
    const sql = `SELECT * FROM commission_entries ${where} ORDER BY created_at DESC, rowid DESC${
      paging ? " LIMIT ? OFFSET ?" : ""
    }`;
    const allParams = paging ? [...params, paging.limit, paging.offset] : params;
    const rows = this.db.prepare(sql).all(...allParams);
    return rows.map(rowToCommissionEntry);
  }

  /** Tong so don khop bo loc - dung de tinh so trang cho /admin/orders. */
  countCommissionEntries(filters?: CommissionEntryFilters): number {
    const { where, params } = buildCommissionEntriesWhere(filters);
    const row = this.db.prepare(`SELECT COUNT(*) AS total FROM commission_entries ${where}`).get(...params) as {
      total: number;
    };
    return row.total;
  }

  /**
   * So lieu cho 4 the KPI dau trang /admin/orders, tinh TREN DUNG bo loc dang ap (2026-10-04).
   *
   * Dung CHUNG buildCommissionEntriesWhere() voi bang ben duoi - neu lech thi the KPI noi mot so ma
   * bang liet ke mot so khac, va admin dung trang nay de doi soat tien nen sai lech o day la nang.
   * `totalEntries` thay luon cho countCommissionEntries() o route /admin/orders: mot truy van, mot
   * bo so, khong the venh nhau.
   *
   * Tien KHONG tinh don "reversed": don da huy khong sinh dong tien nao, cong vao se bien the
   * "Khach nhan" thanh so tien khong ai duoc nhan. Mat khac van dem no trong `totalEntries` (don huy
   * la don co that trong lich su). The KPI co ghi ro dieu nay de admin khong doc nham.
   * Tinh bang SUM trong SQL chu khong keo row len JS - bang tien chi tang chu khong giam.
   */
  getOrdersFilterTotals(filters?: CommissionEntryFilters): OrdersFilterTotals {
    const { where, params } = buildCommissionEntriesWhere(filters);
    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) AS total_entries,
           COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_entries,
           COALESCE(SUM(CASE WHEN status != 'reversed' THEN user_share_amount ELSE 0 END), 0) AS user_share_total,
           COALESCE(SUM(CASE WHEN status != 'reversed' THEN after_tax_amount - user_share_amount ELSE 0 END), 0) AS owner_share_total
         FROM commission_entries ${where}`
      )
      .get(...params) as {
      total_entries: number;
      pending_entries: number;
      user_share_total: number;
      owner_share_total: number;
    };
    return {
      totalEntries: row.total_entries,
      pendingEntries: row.pending_entries,
      userShareTotal: row.user_share_total,
      ownerShareTotal: row.owner_share_total,
    };
  }

  /** Dung boi trang xac nhan huy don tren admin. */
  getEntryById(id: string): CommissionEntry | null {
    const row = this.db.prepare(`SELECT * FROM commission_entries WHERE id = ?`).get(id);
    return row ? rowToCommissionEntry(row) : null;
  }

  /**
   * Tra 1 entry theo (merchant, orderId) - khop dung unique index idx_commission_entries_order.
   * Dung boi shopeeReportImport.ts de tim entry can cap nhat/reverse khi bao cao Shopee doi trang
   * thai cho 1 don da tung ghi nhan truoc do (khong biet truoc id noi bo, chi co orderId).
   */
  getEntryByOrderId(merchant: MerchantId, orderId: string): CommissionEntry | null {
    const row = this.db
      .prepare(`SELECT * FROM commission_entries WHERE merchant = ? AND order_id = ?`)
      .get(merchant, orderId);
    return row ? rowToCommissionEntry(row) : null;
  }

  /** Tra ve token da co neu da tung tao, hoac tao moi neu day la lan dau (idempotent theo platform+userId). */
  findOrCreateDashboardToken(platform: Platform, userId: string): DashboardToken {
    const existing = this.db
      .prepare(`SELECT * FROM dashboard_tokens WHERE platform = ? AND user_id = ?`)
      .get(platform, userId);
    if (existing) {
      return rowToDashboardToken(existing);
    }

    const token = randomBytes(24).toString("hex");
    const createdAt = new Date().toISOString();
    this.db
      .prepare(`INSERT INTO dashboard_tokens (token, platform, user_id, created_at) VALUES (?, ?, ?, ?)`)
      .run(token, platform, userId, createdAt);

    return { token, platform, userId, createdAt };
  }

  getUserByToken(token: string): { platform: Platform; userId: string } | null {
    const row = this.db.prepare(`SELECT * FROM dashboard_tokens WHERE token = ?`).get(token);
    if (!row) return null;
    const t = rowToDashboardToken(row);
    return { platform: t.platform, userId: t.userId };
  }

  /**
   * Kiem tra so du + tao yeu cau + "khoa" cac entry lien quan trong CUNG 1 lan goi dong bo (khong co
   * await xen giua) - DatabaseSync dong bo + Node don luong nen khong co race condition o tang JS.
   * BEGIN/COMMIT o day la de an toan khi crash giua chung, khong phai de chong concurrency.
   */
  requestWithdrawal(
    platform: Platform,
    userId: string,
    thresholdVnd: number,
    bankInfo: { bankName: string; bankAccountNumber: string; bankAccountHolder: string }
  ): WithdrawalRequest {
    const bankName = bankInfo.bankName.trim();
    const bankAccountNumber = bankInfo.bankAccountNumber.trim();
    const bankAccountHolder = bankInfo.bankAccountHolder.trim();
    if (bankName === "" || bankAccountNumber === "" || bankAccountHolder === "") {
      throw new MissingBankInfoError();
    }

    const pending = this.getPendingWithdrawal(platform, userId);
    if (pending) {
      throw new WithdrawalAlreadyPendingError();
    }

    const balance = this.getAvailableBalance(platform, userId);
    if (balance < thresholdVnd) {
      throw new InsufficientBalanceError(balance, thresholdVnd);
    }

    const id = randomUUID();
    const createdAt = new Date().toISOString();

    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          `INSERT INTO withdrawal_requests
            (id, created_at, paid_at, platform, user_id, amount, status, proof_image_path, bank_name, bank_account_number, bank_account_holder)
           VALUES (?, ?, NULL, ?, ?, ?, 'requested', NULL, ?, ?, ?)`
        )
        .run(id, createdAt, platform, userId, balance, bankName, bankAccountNumber, bankAccountHolder);

      this.db
        .prepare(
          `UPDATE commission_entries SET withdrawal_id = ?
           WHERE platform = ? AND user_id = ? AND status = 'confirmed' AND withdrawal_id IS NULL`
        )
        .run(id, platform, userId);

      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }

    return {
      id,
      createdAt,
      paidAt: null,
      platform,
      userId,
      amount: balance,
      status: "requested",
      proofImagePath: null,
      bankName,
      bankAccountNumber,
      bankAccountHolder,
    };
  }

  getPendingWithdrawal(platform: Platform, userId: string): WithdrawalRequest | null {
    const row = this.db
      .prepare(
        `SELECT * FROM withdrawal_requests WHERE platform = ? AND user_id = ? AND status = 'requested' LIMIT 1`
      )
      .get(platform, userId);
    return row ? rowToWithdrawalRequest(row) : null;
  }

  listPendingWithdrawals(): WithdrawalRequest[] {
    const rows = this.db
      .prepare(`SELECT * FROM withdrawal_requests WHERE status = 'requested' ORDER BY created_at ASC`)
      .all();
    return rows.map(rowToWithdrawalRequest);
  }

  /**
   * Dung boi route admin/script sau khi da chuyen khoan tay xong. proofImagePath la ten file anh
   * chup man hinh chuyen khoan thanh cong (da luu san trong WITHDRAWAL_PROOF_DIR boi noi goi).
   *
   * TUY CHON tu 2026-10-01 (yeu cau cua user) - truoc do BAT BUOC de co bang chung doi chieu neu
   * tranh chap (rui ro so 7 trong rui-ro-can-giai-quyet.md); danh doi nay da duoc chap nhan de admin
   * khong bi chan giua luc dang tra tien. Chuoi rong/toan khoang trang duoc chuan hoa ve null chu
   * KHONG luu nguyen: moi noi hien thi deu kiem tra `proofImagePath ? ...` nen "" se bi hieu la CO
   * anh roi render link "Xem ảnh" tro vao file khong ton tai.
   */
  markWithdrawalPaid(withdrawalId: string, proofImagePath: string | null): WithdrawalRequest {
    const storedProof = proofImagePath?.trim() ? proofImagePath.trim() : null;

    const row = this.db.prepare(`SELECT * FROM withdrawal_requests WHERE id = ?`).get(withdrawalId);
    if (!row) {
      throw new Error(`Khong tim thay yeu cau rut tien voi id "${withdrawalId}"`);
    }

    const paidAt = new Date().toISOString();
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(`UPDATE withdrawal_requests SET status = 'paid', paid_at = ?, proof_image_path = ? WHERE id = ?`)
        .run(paidAt, storedProof, withdrawalId);
      this.db
        .prepare(`UPDATE commission_entries SET status = 'paid' WHERE withdrawal_id = ?`)
        .run(withdrawalId);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }

    const updated = rowToWithdrawalRequest(row);
    return { ...updated, status: "paid", paidAt, proofImagePath: storedProof };
  }

  /**
   * Lich su cac yeu cau rut tien da tra, moi nhat truoc - dung cho trang admin xem lai bang chung.
   * Sap xep them theo rowid DESC vi 2 lan markWithdrawalPaid() lien tiep co the ra cung paid_at
   * (ISO string chi chinh xac toi mili giay) - tranh thu tu khong on dinh khi bi tie.
   */
  listPaidWithdrawals(limit = 50): WithdrawalRequest[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM withdrawal_requests WHERE status = 'paid' ORDER BY paid_at DESC, rowid DESC LIMIT ?`
      )
      .all(limit);
    return rows.map(rowToWithdrawalRequest);
  }

  /**
   * Dung boi admin trang/shopeeReportImport.ts khi 1 don "pending" (con cho xu ly) bi huy that su
   * ("Da huy"/"Khong hop le" trong bao cao Shopee). Mac dinh CHI huy duoc entry dang "pending"
   * (2026-08-20, quyet dinh chot lai voi user: don con cho xu ly co the bi huy neu doi soat khong
   * dat, nhung don da "Hoan thanh" la so lieu CUOI CUNG dung de thanh toan, khong doi nua) - goi khong co
   * options se tu choi voi EntryNotPendingError cho moi trang thai khac "pending".
   *
   * `options.allowNonPending`: LOI THOAT rieng CHI cho `ledgerAdmin.ts reverse-entry` (CLI) dung -
   * Shopee ghi tay qua record-conversion/admin web KHONG co giai doan "pending" (di thang len
   * "confirmed" ngay), nen day la cach DUY NHAT de sua loi nhap sai
   * hoac xu ly don Shopee bi tra hang phat hien SAU KHI da ghi nhan. Ngay ca khi bat co nay, van
   * CHAN neu entry da gan vao 1 yeu cau rut tien (EntryAlreadyWithdrawnError) - tien co the da chuyen
   * that, khong the huy 1 chieu qua day duoc nua.
   */
  reverseCommissionEntry(
    entryId: string,
    reason: string,
    options?: { allowNonPending?: boolean }
  ): CommissionEntry {
    const row = this.db.prepare(`SELECT * FROM commission_entries WHERE id = ?`).get(entryId);
    if (!row) {
      throw new Error(`Khong tim thay commission entry voi id "${entryId}"`);
    }

    const existing = rowToCommissionEntry(row);
    if (existing.status !== "pending") {
      if (!options?.allowNonPending) {
        throw new EntryNotPendingError();
      }
      if (existing.withdrawalId !== null) {
        throw new EntryAlreadyWithdrawnError();
      }
    }
    const newNote = existing.note ? `${existing.note} | reversed: ${reason}` : `reversed: ${reason}`;

    this.db
      .prepare(`UPDATE commission_entries SET status = 'reversed', note = ? WHERE id = ?`)
      .run(newNote, entryId);

    return { ...existing, status: "reversed", note: newNote };
  }


  /**
   * Doc 1 setting tu bang `settings` - tra defaultValue neu chua tung duoc admin luu qua
   * /admin/settings (xem SETTINGS_KEYS + src/config/settingsRegistry.ts). Khong cache - moi lan
   * goi query lai SQLite truc tiep (chi phi khong dang ke, nhat quan voi cac method khac).
   */
  // normalizeNewlines o day (READ path, khong chi o route POST /admin/settings) la co chu dich:
  // cac template da luu bang CRLF truoc ban va nay van con nguyen trong DB that, normalize luc doc
  // giup chung tu khoi ma admin khong phai vao sua/luu lai - xem textNormalize.ts.
  getSetting(key: string, defaultValue: string): string {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
      | { value: string }
      | undefined;
    return normalizeNewlines(row ? row.value : defaultValue);
  }

  getSettingInt(key: string, defaultValue: number): number {
    const raw = this.getSetting(key, String(defaultValue));
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? defaultValue : parsed;
  }

  /** Upsert - ghi de neu key da ton tai, khong throw neu chua co (khac cac insert khac trong file nay). */
  setSetting(key: string, value: string): void {
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updatedAt) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`
      )
      .run(key, value, updatedAt);
  }

  // Typed wrapper tien dung cho code nghiep vu (telegram/bot.ts, zalo/bot.ts, server.ts, index.ts,
  // ledgerAdmin.ts) - nhan defaultValue tu call site, khong hard-code default o day (giu core khong
  // phu thuoc env, giong cach recordConversion() nhan taxPercent v.v qua input).
  getUserSharePercent(defaultValue: number): number {
    return this.getSettingInt(SETTINGS_KEYS.userSharePercent, defaultValue);
  }

  getWithdrawalThresholdVnd(defaultValue: number): number {
    return this.getSettingInt(SETTINGS_KEYS.withdrawalThresholdVnd, defaultValue);
  }

  getUsageText(defaultValue: string): string {
    return this.getSetting(SETTINGS_KEYS.usageText, defaultValue);
  }

  getWelcomeMessageTemplate(defaultValue: string): string {
    return this.getSetting(SETTINGS_KEYS.welcomeMessageTemplate, defaultValue);
  }

  getSuccessReplyTemplate(defaultValue: string): string {
    return this.getSetting(SETTINGS_KEYS.successReplyTemplate, defaultValue);
  }

  getGroupJoinWelcomeTemplate(defaultValue: string): string {
    return this.getSetting(SETTINGS_KEYS.groupJoinWelcomeTemplate, defaultValue);
  }

  getGroupJoinBlockedReplyTemplate(defaultValue: string): string {
    return this.getSetting(SETTINGS_KEYS.groupJoinBlockedReplyTemplate, defaultValue);
  }

  getFriendRequestMessage(defaultValue: string): string {
    return this.getSetting(SETTINGS_KEYS.friendRequestMessage, defaultValue);
  }

  getDashboardLinkReplyTemplate(defaultValue: string): string {
    return this.getSetting(SETTINGS_KEYS.dashboardLinkReplyTemplate, defaultValue);
  }

  getOrdersConfirmedTemplate(defaultValue: string): string {
    return this.getSetting(SETTINGS_KEYS.ordersConfirmedTemplate, defaultValue);
  }

  getOrdersConfirmedCaptionTemplate(defaultValue: string): string {
    return this.getSetting(SETTINGS_KEYS.ordersConfirmedCaptionTemplate, defaultValue);
  }

  getWithdrawalRequestedTemplate(defaultValue: string): string {
    return this.getSetting(SETTINGS_KEYS.withdrawalRequestedTemplate, defaultValue);
  }

  getWithdrawalPaidTemplate(defaultValue: string): string {
    return this.getSetting(SETTINGS_KEYS.withdrawalPaidTemplate, defaultValue);
  }

  getGroupReportUpdatedTemplate(defaultValue: string): string {
    return this.getSetting(SETTINGS_KEYS.groupReportUpdatedTemplate, defaultValue);
  }

  /**
   * Ghi 1 dong lich su cho 1 lan "ghi nhan don hang" tren /admin/record-orders (2026-08-23) - goi
   * sau khi da thuc su xu ly xong (ke ca khi ket qua la 0 don moi/0 doi trang thai, de admin thay
   * "da chay luc nay nhung khong co gi thay doi" thay vi khong thay gi ca). Khong ghi cho cac lan
   * that bai truoc khi xu ly (vd thieu file, sai tham so) - loi da hien ngay tren trang, khong can
   * luu lai.
   */
  // ===========================================================================
  // Tong hop cho trang /admin/dashboard (2026-10-01).
  //
  // Tat ca deu tinh bang SQL GROUP BY thay vi keo het row len JS roi reduce - bang tien chi tang
  // chu khong giam, nen "doc het roi tinh" se cham dan theo thoi gian ma khong ai de y.
  //
  // Ngay cua 1 don = DAY_EXPR: uu tien order_date (ngay DAT don that tu bao cao Shopee), thieu thi
  // lui ve created_at quy doi sang gio VN (+7). Dung COALESCE chu khong phai "WHERE order_date IS
  // NOT NULL" - don ghi truoc 2026-10-01 khong co order_date, loc di la chung BIEN MAT khoi chart.
  // ===========================================================================

  /**
   * Khoang ngay nhan vao luon la "YYYY-MM-DD" (gio VN) va duoc so sanh dang CHUOI - dung duoc vi
   * dinh dang nay sap xep theo thu tu tu dien trung voi thu tu thoi gian.
   */
  getDashboardMoneyTotals(
    fromKey: string,
    toKey: string
  ): { commission: number; ownerProfit: number; userShare: number; orderCount: number } {
    const row = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(commission_amount), 0) AS commission,
           COALESCE(SUM(after_tax_amount - user_share_amount), 0) AS owner_profit,
           COALESCE(SUM(user_share_amount), 0) AS user_share,
           COUNT(*) AS order_count
         FROM commission_entries
         WHERE status != 'reversed' AND ${DAY_EXPR} BETWEEN ? AND ?`
      )
      .get(fromKey, toKey) as Record<string, number>;
    return {
      commission: row.commission,
      ownerProfit: row.owner_profit,
      userShare: row.user_share,
      orderCount: row.order_count,
    };
  }

  /** So don MOI trong ky, tach theo trang thai HIEN TAI cua don - du lieu cua chart chinh. */
  countEntriesByDayAndStatus(
    fromKey: string,
    toKey: string
  ): Array<{ day: string; status: CommissionStatus; count: number }> {
    const rows = this.db
      .prepare(
        `SELECT ${DAY_EXPR} AS day, status, COUNT(*) AS count
         FROM commission_entries
         WHERE ${DAY_EXPR} BETWEEN ? AND ?
         GROUP BY day, status`
      )
      .all(fromKey, toKey) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      day: r.day as string,
      status: r.status as CommissionStatus,
      count: r.count as number,
    }));
  }

  sumCommissionByDay(
    fromKey: string,
    toKey: string
  ): Array<{ day: string; commission: number; ownerProfit: number }> {
    const rows = this.db
      .prepare(
        `SELECT ${DAY_EXPR} AS day,
           COALESCE(SUM(commission_amount), 0) AS commission,
           COALESCE(SUM(after_tax_amount - user_share_amount), 0) AS owner_profit
         FROM commission_entries
         WHERE status != 'reversed' AND ${DAY_EXPR} BETWEEN ? AND ?
         GROUP BY day`
      )
      .all(fromKey, toKey) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      day: r.day as string,
      commission: r.commission as number,
      ownerProfit: r.owner_profit as number,
    }));
  }

  countEntriesByStatus(fromKey: string, toKey: string): Array<{ status: CommissionStatus; count: number }> {
    const rows = this.db
      .prepare(
        `SELECT status, COUNT(*) AS count
         FROM commission_entries
         WHERE ${DAY_EXPR} BETWEEN ? AND ?
         GROUP BY status`
      )
      .all(fromKey, toKey) as Array<Record<string, unknown>>;
    return rows.map((r) => ({ status: r.status as CommissionStatus, count: r.count as number }));
  }

  /** Gia tri user se nhan cua cac don dang "pending" trong ky - tien CHUA chac chan. */
  getPendingOrdersInRange(fromKey: string, toKey: string): { count: number; userShareAmount: number } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(user_share_amount), 0) AS amount
         FROM commission_entries
         WHERE status = 'pending' AND ${DAY_EXPR} BETWEEN ? AND ?`
      )
      .get(fromKey, toKey) as Record<string, number>;
    return { count: row.count, userShareAmount: row.amount };
  }

  /**
   * LEFT JOIN user_profiles de lay ten hien thi: bang do chi co user da tung nhan tin voi bot
   * (adapter goi upsertUserProfile), nen JOIN THUONG se lam BIEN MAT user co don nhung chua co
   * ho so - displayName ve null va cho goi tu lui ve userId.
   */
  topUsersByCommission(
    fromKey: string,
    toKey: string,
    limit: number
  ): Array<{
    platform: Platform;
    userId: string;
    displayName: string | null;
    commission: number;
    orderCount: number;
  }> {
    const rows = this.db
      .prepare(
        `SELECT ce.platform AS platform, ce.user_id AS user_id, up.display_name AS display_name,
           COALESCE(SUM(ce.commission_amount), 0) AS commission, COUNT(*) AS order_count
         FROM commission_entries ce
         LEFT JOIN user_profiles up ON up.platform = ce.platform AND up.user_id = ce.user_id
         WHERE ce.status != 'reversed'
           AND COALESCE(ce.order_date, date(ce.created_at, '+7 hours')) BETWEEN ? AND ?
         GROUP BY ce.platform, ce.user_id, up.display_name
         ORDER BY commission DESC, user_id ASC
         LIMIT ?`
      )
      .all(fromKey, toKey, limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      platform: r.platform as Platform,
      userId: r.user_id as string,
      displayName: (r.display_name as string | null) ?? null,
      commission: r.commission as number,
      orderCount: r.order_count as number,
    }));
  }

  /**
   * So du TOAN THOI GIAN, KHONG cat theo ky xem - day la tien that dang treo, doi ky xem tren giao
   * dien khong duoc lam no doi. owedToUsers = phan user da duoc xac nhan va chua bi giu boi 1 yeu
   * cau rut nao (dung dung cong thuc cua getAvailableBalance, chi bo dieu kien theo user).
   */
  getOutstandingTotals(): {
    owedToUsers: number;
    pendingWithdrawalCount: number;
    pendingWithdrawalAmount: number;
    totalUsers: number;
  } {
    const owed = this.db
      .prepare(
        `SELECT COALESCE(SUM(user_share_amount), 0) AS amount
         FROM commission_entries
         WHERE status = 'confirmed' AND withdrawal_id IS NULL`
      )
      .get() as Record<string, number>;
    const withdrawals = this.db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount
         FROM withdrawal_requests WHERE status = 'requested'`
      )
      .get() as Record<string, number>;
    const users = this.db
      .prepare(`SELECT COUNT(*) AS count FROM (SELECT DISTINCT platform, user_id FROM commission_entries)`)
      .get() as Record<string, number>;
    return {
      owedToUsers: owed.amount,
      pendingWithdrawalCount: withdrawals.count,
      pendingWithdrawalAmount: withdrawals.amount,
      totalUsers: users.count,
    };
  }

  /**
   * User MOI cho the KPI dashboard (2026-10-07, yeu cau user): user LAN DAU duoc them vao 1 nhom
   * Zalo bot co mat, gop moi nhom (1 user vao 2 nhom van tinh 1). Doc tu group_join_messages vi bang
   * do da claim DUNG 1 dong/user ngay luc join (xem zalo/bot.ts maybeSendGroupJoinWelcome) - ke ca
   * khi DM chao that bai. Chi co du lieu tu 2026-09-07 (luc co tinh nang chao join group).
   */
  countFirstGroupJoins(fromKey: string, toKey: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM group_join_messages
         WHERE platform = 'zalo' AND date(sent_at, '+7 hours') BETWEEN ? AND ?`
      )
      .get(fromKey, toKey) as Record<string, number>;
    return row.count;
  }

  /** Bu order_date cho 1 entry da ghi truoc khi biet ngay dat don. CHI ghi khi dang NULL - bao cao
   * sau khong duoc quyen ghi de ngay da chot (Shopee liet ke lai ca lich su o moi lan import). */
  backfillOrderDate(entryId: string, orderDate: string): void {
    this.db
      .prepare(`UPDATE commission_entries SET order_date = ? WHERE id = ? AND order_date IS NULL`)
      .run(orderDate, entryId);
  }

  recordImportHistory(input: {
    actionType: ImportActionType;
    newOrderIds: string[];
    statusTransitions: StatusTransition[];
  }): ImportHistoryEntry {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO import_history (id, created_at, action_type, new_order_ids, status_transitions) VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, createdAt, input.actionType, JSON.stringify(input.newOrderIds), JSON.stringify(input.statusTransitions));

    return {
      id,
      createdAt,
      actionType: input.actionType,
      newOrderIds: input.newOrderIds,
      statusTransitions: input.statusTransitions,
    };
  }

  /** Lich su gan nhat truoc, dung cho bang hien thi tren /admin/record-orders. */
  listImportHistory(limit: number): ImportHistoryEntry[] {
    const rows = this.db
      // rowid phu - 2 lan ghi lien tiep co the trung created_at (do ISO string chi phan giai toi
      // milli-giay) khien ORDER BY created_at DESC mot minh khong on dinh thu tu.
      .prepare(`SELECT * FROM import_history ORDER BY created_at DESC, rowid DESC LIMIT ?`)
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as string,
      createdAt: r.created_at as string,
      actionType: r.action_type as ImportActionType,
      newOrderIds: JSON.parse(r.new_order_ids as string) as string[],
      statusTransitions: JSON.parse(r.status_transitions as string) as StatusTransition[],
    }));
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Ty le DA CHOT cua 1 entry neu co, con khong thi ty le hien hanh do caller truyen vao. Dung boi
 * updatePendingEntry/confirmPendingEntry: don "pending" con duoc cap nhat so lieu o moi lan import
 * bao cao Shopee (hoa hong that con doi), nhung TIEN phai tinh bang ty le luc don duoc ghi nhan -
 * ha % hom nay khong duoc ha tien cua don user mua tu tuan truoc.
 *
 * Chi lui ve fallback cho entry ghi TRUOC khi co 3 cot % (null) - xem migrateAddRatePercentColumns.
 */
function effectivePercents(existing: CommissionEntry, fallback: RatePercents): RatePercents {
  return {
    taxPercent: existing.taxPercent ?? fallback.taxPercent,
    platformFeePercent: existing.platformFeePercent ?? fallback.platformFeePercent,
    userSharePercent: existing.userSharePercent ?? fallback.userSharePercent,
  };
}

function rowToCommissionEntry(row: unknown): CommissionEntry {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as string,
    createdAt: r.created_at as string,
    orderDate: (r.order_date as string | null) ?? null,
    platform: r.platform as Platform,
    userId: r.user_id as string,
    merchant: r.merchant as MerchantId,
    subId: r.sub_id as string,
    orderId: r.order_id as string,
    productName: (r.product_name as string | null) ?? null,
    orderAmount: r.order_amount as number,
    commissionAmount: r.commission_amount as number,
    taxAmount: r.tax_amount as number,
    platformFeeAmount: r.platform_fee_amount as number,
    afterTaxAmount: r.after_tax_amount as number,
    userShareAmount: r.user_share_amount as number,
    taxPercent: (r.tax_percent as number | null) ?? null,
    platformFeePercent: (r.platform_fee_percent as number | null) ?? null,
    userSharePercent: (r.user_share_percent as number | null) ?? null,
    status: r.status as CommissionStatus,
    withdrawalId: (r.withdrawal_id as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    // Chi co gia tri khi query nay JOIN withdrawal_requests (xem getUserSummary) - cac SELECT * FROM
    // commission_entries thuan (getEntryById, listCommissionEntries...) khong co cot nay, ve null.
    proofImagePath: (r.withdrawal_proof_image_path as string | null) ?? null,
  };
}

function rowToWithdrawalRequest(row: unknown): WithdrawalRequest {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as string,
    createdAt: r.created_at as string,
    paidAt: (r.paid_at as string | null) ?? null,
    platform: r.platform as Platform,
    userId: r.user_id as string,
    amount: r.amount as number,
    status: r.status as WithdrawalRequest["status"],
    proofImagePath: (r.proof_image_path as string | null) ?? null,
    bankName: (r.bank_name as string | null) ?? "",
    bankAccountNumber: (r.bank_account_number as string | null) ?? "",
    bankAccountHolder: (r.bank_account_holder as string | null) ?? "",
  };
}

function rowToDashboardToken(row: unknown): DashboardToken {
  const r = row as Record<string, unknown>;
  return {
    token: r.token as string,
    platform: r.platform as Platform,
    userId: r.user_id as string,
    createdAt: r.created_at as string,
  };
}

function mapZaloGroupRow(row: {
  group_id: string;
  name: string;
  notify_enabled: number;
  created_at: string;
  last_seen_at: string;
}): ZaloGroup {
  return {
    groupId: row.group_id,
    name: row.name,
    notifyEnabled: row.notify_enabled === 1,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}
