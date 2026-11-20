
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

  // 防止数据库中的异常路径导致删除存储目录以外的文件。
  if (!/^[0-9a-f-]{36}$/i.test(file.storage_name)) {
    throw new Error("Invalid stored file name");
  }

  const filePath = join(filesDirectory, file.storage_name);

  try {
    await unlink(filePath);
  } catch (error) {
    // 磁盘文件已经不存在时，仍然允许清理数据库记录。
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  db.prepare(`
    DELETE FROM files
    WHERE id = ? AND owner_id = ?
  `).run(fileId, ownerId);

  return true;
}
