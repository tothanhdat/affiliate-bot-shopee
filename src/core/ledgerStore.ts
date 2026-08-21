import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import {
  DuplicateConversionError,
  EntryAlreadyWithdrawnError,
  EntryNotPendingError,
  ImplausibleCommissionAmountError,
  InsufficientBalanceError,
  InvalidPaymentAmountError,
  MissingBankInfoError,
  MissingWithdrawalProofError,
  WithdrawalAlreadyPendingError,
} from "./errors.js";
import type { MerchantId } from "./merchants.js";
import type {
  AccesstradePayment,
  CommissionEntry,
  CommissionStatus,
  DashboardToken,
  Platform,
  ReconciliationSummary,
  WithdrawalRequest,
} from "./types.js";

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
  status?: CommissionStatus;
  note?: string;
}

export interface UserLedgerSummary {
  entries: CommissionEntry[];
  availableBalance: number;
  pendingBalance: number;
  paidTotal: number;
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

      CREATE TABLE IF NOT EXISTS accesstrade_payments (
        id TEXT PRIMARY KEY,
        received_at TEXT NOT NULL,
        amount INTEGER NOT NULL,
        note TEXT
      );

      CREATE TABLE IF NOT EXISTS welcome_messages (
        platform TEXT NOT NULL,
        user_id TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        PRIMARY KEY (platform, user_id)
      );
    `);
    // DB tao truoc khi co yeu cau dinh kem bang chung chuyen khoan (2026-08-19) se thieu cot nay.
    this.migrateAddWithdrawalProofColumn();
    // DB tao truoc khi co form ngan hang bat buoc (2026-08-20) se thieu 3 cot nay.
    this.migrateAddBankInfoColumns();
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

    const taxAmount = Math.round((input.commissionAmount * input.taxPercent) / 100);
    const afterTaxOnly = input.commissionAmount - taxAmount;
    const platformFeeAmount = Math.round((afterTaxOnly * input.platformFeePercent) / 100);
    const afterTaxAmount = afterTaxOnly - platformFeeAmount;
    const userShareAmount = Math.round((afterTaxAmount * input.userSharePercent) / 100);

    try {
      this.db
        .prepare(
          `INSERT INTO commission_entries
            (id, created_at, platform, user_id, merchant, sub_id, order_id, product_name, order_amount, commission_amount, tax_amount, platform_fee_amount, after_tax_amount, user_share_amount, status, withdrawal_id, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
        )
        .run(
          id,
          createdAt,
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
      status,
      withdrawalId: null,
      note: input.note ?? null,
      proofImagePath: null,
    };
  }

  /**
   * Cap nhat lai order_amount/commission_amount (va thue/phi/userShare tinh lai theo) cho 1 entry
   * VAN CON "pending" (2026-08-21, phat hien qua bao cao thuc te: Accesstrade tra ve commission=0
   * luc giao dich con hold, roi dien dan so lieu uoc tinh that len dashboard cua ho TRUOC KHI duyet
   * hang - nhung sync cu bo qua hoan toan entry da ton tai bat ke trang thai gi (`if (existing)
   * continue`), nen dashboard cua bot ket qua bi "dong bang" o 0d cho toi khi don duoc duyet, du
   * Accesstrade da hien so uoc tinh that tu lau). KHONG doi status (van "pending"), chi cap nhat so
   * lieu hien thi - khac confirmPendingEntry (doi status sang "confirmed").
   */
  updatePendingEntry(
    entryId: string,
    input: {
      orderAmount: number;
      commissionAmount: number;
      productName?: string | null;
      taxPercent: number;
      platformFeePercent: number;
      userSharePercent: number;
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

    const taxAmount = Math.round((input.commissionAmount * input.taxPercent) / 100);
    const afterTaxOnly = input.commissionAmount - taxAmount;
    const platformFeeAmount = Math.round((afterTaxOnly * input.platformFeePercent) / 100);
    const afterTaxAmount = afterTaxOnly - platformFeeAmount;
    const userShareAmount = Math.round((afterTaxAmount * input.userSharePercent) / 100);
    const productName = input.productName ?? existing.productName;

    this.db
      .prepare(
        `UPDATE commission_entries SET order_amount = ?, commission_amount = ?,
          tax_amount = ?, platform_fee_amount = ?, after_tax_amount = ?, user_share_amount = ?, product_name = ?
         WHERE id = ?`
      )
      .run(
        input.orderAmount,
        input.commissionAmount,
        taxAmount,
        platformFeeAmount,
        afterTaxAmount,
        userShareAmount,
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
      productName,
    };
  }

  /**
   * Chuyen 1 entry dang "pending" (tao boi accesstradeSync.ts khi Accesstrade con hold/chua chot,
   * 2026-08-20) sang "confirmed" khi Accesstrade sau do duyet that (status=1+is_confirmed=1) -
   * UPDATE tai cho thay vi INSERT moi, vi INSERT se dung UNIQUE constraint (merchant, order_id)
   * da co san tu luc con pending (DuplicateConversionError). Tinh lai thue/phi/userShare tu
   * commissionAmount/orderAmount MOI NHAT Accesstrade tra ve luc duyet - co the khac nhe so voi
   * luc con hold (hiem nhung co the xay ra), khong tin so lieu cu.
   */
  confirmPendingEntry(
    entryId: string,
    input: {
      orderAmount: number;
      commissionAmount: number;
      productName?: string | null;
      taxPercent: number;
      platformFeePercent: number;
      userSharePercent: number;
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

    const taxAmount = Math.round((input.commissionAmount * input.taxPercent) / 100);
    const afterTaxOnly = input.commissionAmount - taxAmount;
    const platformFeeAmount = Math.round((afterTaxOnly * input.platformFeePercent) / 100);
    const afterTaxAmount = afterTaxOnly - platformFeeAmount;
    const userShareAmount = Math.round((afterTaxAmount * input.userSharePercent) / 100);
    const productName = input.productName ?? existing.productName;

    this.db
      .prepare(
        `UPDATE commission_entries SET status = 'confirmed', order_amount = ?, commission_amount = ?,
          tax_amount = ?, platform_fee_amount = ?, after_tax_amount = ?, user_share_amount = ?, product_name = ?
         WHERE id = ?`
      )
      .run(
        input.orderAmount,
        input.commissionAmount,
        taxAmount,
        platformFeeAmount,
        afterTaxAmount,
        userShareAmount,
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
  }> {
    const rows = this.db
      .prepare(
        `SELECT ce.platform AS platform, ce.user_id AS user_id, up.display_name AS display_name,
            COALESCE(SUM(CASE WHEN ce.status = 'confirmed' AND ce.withdrawal_id IS NULL THEN ce.user_share_amount ELSE 0 END), 0) AS available,
            COALESCE(SUM(CASE WHEN ce.status = 'confirmed' AND ce.withdrawal_id IS NOT NULL THEN ce.user_share_amount ELSE 0 END), 0) AS pending,
            COALESCE(SUM(CASE WHEN ce.status = 'paid' THEN ce.user_share_amount ELSE 0 END), 0) AS paid,
            COUNT(*) AS orders_count
         FROM commission_entries ce
         LEFT JOIN user_profiles up ON up.platform = ce.platform AND up.user_id = ce.user_id
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
    }>;

    return rows.map((r) => ({
      platform: r.platform,
      userId: r.user_id,
      displayName: r.display_name,
      availableBalance: r.available,
      pendingBalance: r.pending,
      paidTotal: r.paid,
      ordersCount: r.orders_count,
    }));
  }

  /** Danh sach don hang cho trang admin /admin/orders, loc tuy chon. Gioi han 300 ban ghi gan nhat. */
  listCommissionEntries(filters?: {
    platform?: Platform;
    userId?: string;
    merchant?: MerchantId;
    status?: CommissionStatus;
  }): CommissionEntry[] {
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
    if (filters?.status) {
      conditions.push("status = ?");
      params.push(filters.status);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = this.db
      .prepare(`SELECT * FROM commission_entries ${where} ORDER BY created_at DESC LIMIT 300`)
      .all(...params);
    return rows.map(rowToCommissionEntry);
  }

  /** Dung boi trang xac nhan huy don tren admin. */
  getEntryById(id: string): CommissionEntry | null {
    const row = this.db.prepare(`SELECT * FROM commission_entries WHERE id = ?`).get(id);
    return row ? rowToCommissionEntry(row) : null;
  }

  /**
   * Tra 1 entry theo (merchant, orderId) - khop dung unique index idx_commission_entries_order.
   * Dung boi accesstradeSync.ts de tim entry can reverse khi Accesstrade tra ve status=rejected
   * cho 1 don da tung ghi nhan "confirmed" truoc do (khong biet truoc id noi bo, chi co orderId).
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
   * chup man hinh chuyen khoan thanh cong (da luu san trong WITHDRAWAL_PROOF_DIR boi noi goi) -
   * BAT BUOC, khong nhan chuoi rong, de sau nay co bang chung doi chieu neu co tranh chap (rui ro
   * so 7 trong rui-ro-can-giai-quyet.md).
   */
  markWithdrawalPaid(withdrawalId: string, proofImagePath: string): WithdrawalRequest {
    if (proofImagePath.trim() === "") {
      throw new MissingWithdrawalProofError();
    }

    const row = this.db.prepare(`SELECT * FROM withdrawal_requests WHERE id = ?`).get(withdrawalId);
    if (!row) {
      throw new Error(`Khong tim thay yeu cau rut tien voi id "${withdrawalId}"`);
    }

    const paidAt = new Date().toISOString();
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(`UPDATE withdrawal_requests SET status = 'paid', paid_at = ?, proof_image_path = ? WHERE id = ?`)
        .run(paidAt, proofImagePath, withdrawalId);
      this.db
        .prepare(`UPDATE commission_entries SET status = 'paid' WHERE withdrawal_id = ?`)
        .run(withdrawalId);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }

    const updated = rowToWithdrawalRequest(row);
    return { ...updated, status: "paid", paidAt, proofImagePath };
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
   * Dung boi admin trang/accesstradeSync.ts khi 1 don "pending" (Accesstrade con hold/chua chot)
   * bi tu choi that su (status=2). Mac dinh CHI huy duoc entry dang "pending" (2026-08-20, quyet
   * dinh chot lai voi user, dua theo FAQ chinh thuc cua Accesstrade: "hoa hong tam duyet" (~pending
   * ben minh) co the bi huy neu doi soat khong dat, nhung "hoa hong duoc duyet" (~confirmed,
   * is_confirmed=1) la so lieu CUOI CUNG dung de thanh toan, khong con thay doi nua) - goi khong co
   * options se tu choi voi EntryNotPendingError cho moi trang thai khac "pending".
   *
   * `options.allowNonPending`: LOI THOAT rieng CHI cho `ledgerAdmin.ts reverse-entry` (CLI) dung -
   * Shopee ghi tay qua record-conversion/CSV/admin web KHONG co giai doan "pending" (di thang len
   * "confirmed" ngay, khong qua accesstradeSync.ts), nen day la cach DUY NHAT de sua loi nhap sai
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
   * Ghi 1 lan Accesstrade CHUYEN KHOAN THAT cho chu bot (nhap tay, doi chieu voi ngan hang).
   * receivedAt tuy chon (ISO) - cho phep admin chon lai dung ngay Accesstrade chuyen (vd nhap tre vai
   * ngay so voi luc ghi vao he thong), mac dinh la thoi diem ghi neu khong truyen vao.
   */
  recordAccesstradePayment(input: { amountVnd: number; note?: string; receivedAt?: string }): AccesstradePayment {
    if (!(input.amountVnd > 0)) {
      throw new InvalidPaymentAmountError();
    }

    const id = randomUUID();
    const receivedAt = input.receivedAt ?? new Date().toISOString();
    this.db
      .prepare(`INSERT INTO accesstrade_payments (id, received_at, amount, note) VALUES (?, ?, ?, ?)`)
      .run(id, receivedAt, input.amountVnd, input.note ?? null);

    return { id, receivedAt, amountVnd: input.amountVnd, note: input.note ?? null };
  }

  /** Lich su tat ca lan ghi nhan Accesstrade da chuyen tien, moi nhat truoc. */
  listAccesstradePayments(): AccesstradePayment[] {
    const rows = this.db.prepare(`SELECT * FROM accesstrade_payments ORDER BY received_at DESC`).all();
    return rows.map(rowToAccesstradePayment);
  }

  /**
   * Doi chieu dong tien: tong DA NHAN THAT tu Accesstrade (accesstrade_payments) vs tong DA TRA THAT
   * cho user (withdrawal_requests da 'paid' - khong dung commission_entries vi entry 'confirmed' chua
   * chac da thanh tien that roi khoi tai khoan). remainingVnd am = dang tra vuot qua so tien thuc nhan.
   */
  getReconciliationSummary(): ReconciliationSummary {
    const receivedRow = this.db
      .prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM accesstrade_payments`)
      .get() as { total: number };
    const paidRow = this.db
      .prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM withdrawal_requests WHERE status = 'paid'`)
      .get() as { total: number };

    return {
      totalReceivedVnd: receivedRow.total,
      totalPaidToUsersVnd: paidRow.total,
      remainingVnd: receivedRow.total - paidRow.total,
    };
  }

  close(): void {
    this.db.close();
  }
}

function rowToCommissionEntry(row: unknown): CommissionEntry {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as string,
    createdAt: r.created_at as string,
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

function rowToAccesstradePayment(row: unknown): AccesstradePayment {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as string,
    receivedAt: r.received_at as string,
    amountVnd: r.amount as number,
    note: (r.note as string | null) ?? null,
  };
}
