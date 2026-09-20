import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type AuditLevel = 'info' | 'warn' | 'error';

export type AuditCategory =
  | 'auth'
  | 'pin'
  | 'bookmark'
  | 'container'
  | 'git'
  | 'backup'
  | 'config'
  | 'app-update'
  | 'system'
  | 'storage';

export interface AuditLogEntry {
  id: string;
  category: AuditCategory;
  level: AuditLevel;
  message: string;
  actor: string | null;
  detail?: string;
  createdAt: number;
}

interface AuditLogDb {
  entries: AuditLogEntry[];
}

const MAX_ENTRIES = 5000;

/**
 * The full activity/error trail for the dashboard — every state-changing
 * action across services, plus errors, in one place for problem solving.
 * Unlike NotificationsService (a 50-entry activity feed for the UI bell),
 * this is meant to be a real audit log, so it keeps far more history.
 */
export class AuditLogService {
  private dbPath: string;
  private db: AuditLogDb;

  constructor() {
    const dataDir = path.resolve(__dirname, '../../../data');
    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch {
        // fallback
      }
    }
    this.dbPath = path.join(dataDir, 'audit-log.json');
    this.db = this.loadDb();
  }

  private loadDb(): AuditLogDb {
    try {
      if (fs.existsSync(this.dbPath)) {
        const raw = fs.readFileSync(this.dbPath, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (err) {
      console.error('[AuditLogService] Error reading database:', err);
    }
    return { entries: [] };
  }

  private saveDb() {
    try {
      fs.writeFileSync(this.dbPath, JSON.stringify(this.db, null, 2), 'utf-8');
    } catch (err) {
      console.error('[AuditLogService] Error writing database:', err);
    }
  }

  public getAll(): AuditLogEntry[] {
    return this.db.entries;
  }

  public log(
    category: AuditCategory,
    level: AuditLevel,
    message: string,
    options?: { actor?: string | null; detail?: string }
  ) {
    const entry: AuditLogEntry = {
      id: crypto.randomUUID(),
      category,
      level,
      message,
      actor: options?.actor ?? null,
      detail: options?.detail,
      createdAt: Date.now(),
    };
    this.db.entries.unshift(entry);
    if (this.db.entries.length > MAX_ENTRIES) {
      this.db.entries = this.db.entries.slice(0, MAX_ENTRIES);
    }
    this.saveDb();
    return entry;
  }

  public clear() {
    this.db.entries = [];
    this.saveDb();
  }
}

export const auditLogService = new AuditLogService();
