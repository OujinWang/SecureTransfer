import { db } from "../db.js";
import type { FileMetadata } from "@secure-transfer/shared";

interface FileRow {
  id: string;
  original_name: string;
  size: number;
  sha256: string;
  created_at: string;
}

/** 查询指定用户拥有的文件。 */
export function listFiles(ownerId: string): FileMetadata[] {
  const rows = db.prepare(`
    SELECT id, original_name, size, sha256, created_at
    FROM files
    WHERE owner_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(ownerId) as FileRow[];

  return rows.map((row) => ({
    id: row.id,
    originalName: row.original_name,
    size: row.size,
    sha256: row.sha256,
    createdAt: row.created_at,
  }));
}