import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { Platform, RequestLogEntry, RequestOutcome } from "./types.js";

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
  }

  record(entry: Omit<RequestLogEntry, "id" | "timestamp"> & { timestamp?: string }): RequestLogEntry {
    const full: RequestLogEntry = {
      id: randomUUID(),
      timestamp: entry.timestamp ?? new Date().toISOString(),
      platform: entry.platform,
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
          (id, timestamp, platform, user_id, original_url, sub_id, outcome, error_code, affiliate_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        full.id,
        full.timestamp,
        full.platform,
        full.userId,
        full.originalUrl,
        full.subId,
        full.outcome,
        full.errorCode,
        full.affiliateUrl
      );

    return full;
  }

  /** Lay log theo khoang ngay (ISO date, vi du "2026-07-31"), loc theo platform neu co. */
  queryByDateRange(
    fromDateInclusive: string,
    toDateInclusive: string,
    platform?: Platform
  ): RequestLogEntry[] {
    const from = `${fromDateInclusive}T00:00:00.000Z`;
    const to = `${toDateInclusive}T23:59:59.999Z`;

    const rows = platform
      ? this.db
          .prepare(
            `SELECT * FROM requests WHERE timestamp BETWEEN ? AND ? AND platform = ? ORDER BY timestamp DESC`
          )
          .all(from, to, platform)
      : this.db
          .prepare(`SELECT * FROM requests WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp DESC`)
          .all(from, to);

    return rows.map(rowToEntry);
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
    userId: r.user_id as string,
    originalUrl: r.original_url as string,
    subId: (r.sub_id as string | null) ?? null,
    outcome: r.outcome as RequestOutcome,
    errorCode: (r.error_code as string | null) ?? null,
    affiliateUrl: (r.affiliate_url as string | null) ?? null,
  };
}
