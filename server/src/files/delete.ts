import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../db.js";

interface StoredFile {
  storage_name: string;
}

const filesDirectory = fileURLToPath(
  new URL("../../data/files/", import.meta.url),
);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * 删除当前用户拥有的文件。
 * 不存在或不属于当前用户的文件统一返回 false。
 */
export async function deleteOwnedFile(
  ownerId: string,
  fileId: string,
): Promise<boolean> {
  const file = db.prepare(`
    SELECT storage_name
    FROM files
    WHERE id = ? AND owner_id = ?
  `).get(fileId, ownerId) as StoredFile | undefined;

  if (!file) {
    return false;
  }

  if (!UUID_PATTERN.test(file.storage_name)) {
    throw new Error("Invalid stored file name");
  }

  // 事务内再次检查所有权并删除记录。
  // file_shares 记录由外键 ON DELETE CASCADE 自动清理。
  const deleted = db.transaction(() => {
    const result = db.prepare(`
      DELETE FROM files
      WHERE id = ? AND owner_id = ?
    `).run(fileId, ownerId);

    return result.changes > 0;
  })();

  if (!deleted) {
    return false;
  }

  const filePath = join(filesDirectory, file.storage_name);

  try {
    await unlink(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code !== "ENOENT") {
      console.error("Failed to remove deleted file:", error);
    }
  }

  return true;
}