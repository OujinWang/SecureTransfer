
import { randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FILE_CHUNK_SIZE } from "@secure-transfer/shared";
import { db } from "../db.js";

import type { FileHandle } from "node:fs/promises";
import type {
  FileDownloadInitResult,
  FileMetadata,
} from "@secure-transfer/shared";
import type { WebSocket } from "ws";

interface FileRow {
  id: string;
  original_name: string;
  storage_name: string;
  size: number;
  sha256: string;
  created_at: string;
}

interface DownloadSession {
  transferId: string;
  handle: FileHandle;
  size: number;
  lastActivity: number;
}

type DownloadResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

const filesDirectory = fileURLToPath(
  new URL("../../data/files/", import.meta.url),
);

const downloads = new WeakMap<WebSocket, DownloadSession>();
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

function failure(
  code: string,
  message: string,
): { ok: false; code: string; message: string } {
  return { ok: false, code, message };
}

/** 验证文件所有权并初始化下载。 */
export async function initializeDownload(
  socket: WebSocket,
  ownerId: string,
  fileId: string,
): Promise<DownloadResult<FileDownloadInitResult>> {
  if (downloads.has(socket)) {
    return failure("DOWNLOAD_IN_PROGRESS", "Download already in progress");
  }

  const row = db.prepare(`
    SELECT id, original_name, storage_name, size, sha256, created_at
    FROM files
    WHERE id = ? AND owner_id = ?
  `).get(fileId, ownerId) as FileRow | undefined;

  if (!row) {
    return failure("FILE_NOT_FOUND", "File not found");
  }

  if (!/^[0-9a-f-]{36}$/i.test(row.storage_name)) {
    return failure("INVALID_FILE", "Invalid stored file");
  }

  let handle: FileHandle;

  try {
    handle = await open(join(filesDirectory, row.storage_name), "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return failure("FILE_NOT_FOUND", "Stored file not found");
    }
    throw error;
  }

  try {
    const stat = await handle.stat();

    if (!stat.isFile() || stat.size !== row.size) {
      return failure("FILE_CORRUPTED", "Stored file size mismatch");
    }

    const transferId = randomUUID();
    const file: FileMetadata = {
      id: row.id,
      originalName: row.original_name,
      size: row.size,
      sha256: row.sha256,
      createdAt: row.created_at,
    };

    downloads.set(socket, {
      transferId,
      handle,
      size: row.size,
      lastActivity: Date.now(),
    });

    return {
      ok: true,
      data: {
        transferId,
        file,
        chunkSize: FILE_CHUNK_SIZE,
      },
    };
  } finally {
    if (!downloads.has(socket)) {
      await handle.close();
    }
  }
}

/** 按序号读取指定文件块。 */
export async function readDownloadChunk(
  socket: WebSocket,
  transferId: string,
  sequence: number,
): Promise<DownloadResult<{ transferId: string; sequence: number; chunk: Buffer }>> {
  const session = downloads.get(socket);

  if (!session || session.transferId !== transferId) {
    return failure("TRANSFER_NOT_FOUND", "Download not found");
  }

  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    return failure("INVALID_SEQUENCE", "Invalid chunk sequence");
  }

  const position = sequence * FILE_CHUNK_SIZE;

  if (!Number.isSafeInteger(position) || position >= session.size) {
    return failure("INVALID_SEQUENCE", "Chunk out of range");
  }

  const length = Math.min(FILE_CHUNK_SIZE, session.size - position);
  const chunk = Buffer.allocUnsafe(length);
  let received = 0;

  while (received < length) {
    const { bytesRead } = await session.handle.read(
      chunk,
      received,
      length - received,
      position + received,
    );

    if (bytesRead === 0) {
      throw new Error("Unexpected end of stored file");
    }

    received += bytesRead;
  }

  session.lastActivity = Date.now();

  return {
    ok: true,
    data: { transferId, sequence, chunk },
  };
}

/** 结束下载并释放文件句柄。 */
export async function closeDownload(
  socket: WebSocket,
  transferId?: string,
): Promise<boolean> {
  const session = downloads.get(socket);

  if (!session) return false;
  if (transferId !== undefined && session.transferId !== transferId) {
    return false;
  }

  downloads.delete(socket);
  await session.handle.close();
  return true;
}

/** 清理超时下载。 */
export async function cleanupExpiredDownload(
  socket: WebSocket,
): Promise<void> {
  const session = downloads.get(socket);

  if (
    session &&
    Date.now() - session.lastActivity >= DOWNLOAD_TIMEOUT_MS
  ) {
    await closeDownload(socket);
  }
}
