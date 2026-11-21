
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FILE_CHUNK_SIZE, MAX_FILE_SIZE } from "@secure-transfer/shared";
import { db } from "../db.js";

import type { FileHandle } from "node:fs/promises";
import type {
  FileMetadata,
  FileUploadInitPayload,
  FileUploadInitResult,
} from "@secure-transfer/shared";
import type { WebSocket } from "ws";

interface UploadSession {
  ownerId: string;
  transferId: string;
  name: string;
  size: number;
  sha256: string;
  path: string;
  file: FileHandle;
  received: number;
  nextSequence: number;
  lastActivity: number;
}

type UploadResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

const dataDirectory =
  process.env.DATA_DIR ??
  fileURLToPath(new URL("../../data/", import.meta.url));

const tempDirectory = join(dataDirectory, "temp");
const filesDirectory = join(dataDirectory, "files");

const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const FRAME_HEADER_SIZE = 40;

const uploads = new WeakMap<WebSocket, UploadSession>();

function failure(
  code: string,
  message: string,
): { ok: false; code: string; message: string } {
  return { ok: false, code, message };
}

/** 验证上传文件的基本信息。 */
function validatePayload(value: unknown): value is FileUploadInitPayload {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const payload = value as Record<string, unknown>;

  return (
    typeof payload.name === "string" &&
    payload.name.length > 0 &&
    Buffer.byteLength(payload.name, "utf8") <= 255 &&
    payload.name !== "." &&
    payload.name !== ".." &&
    !/[/\\\x00-\x1f\x7f]/.test(payload.name) &&
    typeof payload.size === "number" &&
    Number.isSafeInteger(payload.size) &&
    payload.size >= 0 &&
    payload.size <= MAX_FILE_SIZE &&
    typeof payload.sha256 === "string" &&
    /^[a-fA-F0-9]{64}$/.test(payload.sha256)
  );
}

/** 初始化上传任务。 */
export async function initializeUpload(
  socket: WebSocket,
  ownerId: string,
  payload: unknown,
): Promise<UploadResult<FileUploadInitResult>> {
  if (!validatePayload(payload)) {
    return failure(
      "INVALID_FILE",
      "Invalid file name, size or SHA-256",
    );
  }

  if (uploads.has(socket)) {
    return failure(
      "UPLOAD_IN_PROGRESS",
      "An upload is already in progress",
    );
  }

  await mkdir(tempDirectory, { recursive: true });

  const transferId = randomUUID();
  const path = join(tempDirectory, transferId);
  const file = await open(path, "wx");

  uploads.set(socket, {
    ownerId,
    transferId,
    name: payload.name,
    size: payload.size,
    sha256: payload.sha256.toLowerCase(),
    path,
    file,
    received: 0,
    nextSequence: 0,
    lastActivity: Date.now(),
  });

  return {
    ok: true,
    data: {
      transferId,
      chunkSize: FILE_CHUNK_SIZE,
    },
  };
}

/** 接收并写入一个二进制文件块。 */
export async function receiveUploadChunk(
  socket: WebSocket,
  data: Buffer,
): Promise<UploadResult<{ transferId: string; sequence: number; received: number }>> {
  const upload = uploads.get(socket);

  if (!upload) {
    return failure("TRANSFER_NOT_FOUND", "No active upload");
  }

  if (
    data.length <= FRAME_HEADER_SIZE ||
    data.length > FRAME_HEADER_SIZE + FILE_CHUNK_SIZE
  ) {
    return failure("INVALID_CHUNK", "Invalid chunk size");
  }

  const transferId = data.toString("ascii", 0, 36);
  const sequence = data.readUInt32BE(36);
  const content = data.subarray(FRAME_HEADER_SIZE);

  if (transferId !== upload.transferId) {
    return failure("TRANSFER_NOT_FOUND", "Invalid transfer ID");
  }

  if (sequence !== upload.nextSequence) {
    return failure("INVALID_SEQUENCE", "Unexpected chunk sequence");
  }

  if (upload.received + content.length > upload.size) {
    return failure("FILE_TOO_LARGE", "File exceeds declared size");
  }

  let offset = 0;

  while (offset < content.length) {
    const { bytesWritten } = await upload.file.write(
      content,
      offset,
      content.length - offset,
      upload.received + offset,
    );

    if (bytesWritten <= 0) {
      throw new Error("Failed to write upload chunk");
    }

    offset += bytesWritten;
  }

  upload.received += content.length;
  upload.nextSequence++;
  upload.lastActivity = Date.now();

  return {
    ok: true,
    data: {
      transferId,
      sequence,
      received: upload.received,
    },
  };
}

/** 取消上传并删除临时文件。 */
export async function cancelUpload(
  socket: WebSocket,
  transferId?: string,
): Promise<boolean> {
  const upload = uploads.get(socket);

  if (!upload) return false;

  if (
    transferId !== undefined &&
    transferId !== upload.transferId
  ) {
    return false;
  }

  uploads.delete(socket);

  try {
    await upload.file.close();
  } finally {
    await unlink(upload.path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }

  return true;
}

/** 完成上传，校验文件并登记数据库。 */
export async function completeUpload(
  socket: WebSocket,
  transferId: string,
): Promise<UploadResult<{ file: FileMetadata }>> {
  const upload = uploads.get(socket);

  if (!upload || upload.transferId !== transferId) {
    return failure("TRANSFER_NOT_FOUND", "Upload not found");
  }

  if (upload.received !== upload.size) {
    return failure("INCOMPLETE_UPLOAD", "File upload is incomplete");
  }

  let storagePath: string | null = null;

  try {
    await upload.file.sync();
    await upload.file.close();

    const source = await open(upload.path, "r");

    let actualHash: string;

    try {
      const hash = createHash("sha256");
      const buffer = Buffer.allocUnsafe(FILE_CHUNK_SIZE);
      let position = 0;

      while (position < upload.size) {
        const { bytesRead } = await source.read(
          buffer,
          0,
          Math.min(buffer.length, upload.size - position),
          position,
        );

        if (bytesRead === 0) {
          throw new Error("Unexpected end of uploaded file");
        }

        hash.update(buffer.subarray(0, bytesRead));
        position += bytesRead;
      }

      actualHash = hash.digest("hex");
    } finally {
      await source.close();
    }

    if (actualHash !== upload.sha256) {
      await cancelUpload(socket);
      return failure("HASH_MISMATCH", "File SHA-256 mismatch");
    }

    await mkdir(filesDirectory, { recursive: true });

    const fileId = randomUUID();
    const storageName = randomUUID();
    storagePath = join(filesDirectory, storageName);

    await rename(upload.path, storagePath);

    const createdAt = new Date().toISOString();

    db.prepare(`
      INSERT INTO files (
        id, owner_id, original_name, storage_name,
        size, sha256, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      fileId,
      upload.ownerId,
      upload.name,
      storageName,
      upload.size,
      actualHash,
      createdAt,
    );

    uploads.delete(socket);

    return {
      ok: true,
      data: {
        file: {
          id: fileId,
          originalName: upload.name,
          size: upload.size,
          sha256: actualHash,
          createdAt,
        },
      },
    };
  }catch (error) {
    await cancelUpload(socket).catch((cleanupError) => {
      console.error("Failed to clean up upload:", cleanupError);
    });

    if (storagePath) {
      await unlink(storagePath).catch((cleanupError: NodeJS.ErrnoException) => {
        if (cleanupError.code !== "ENOENT") {
          console.error(
            "Failed to remove stored file after upload error:",
            cleanupError,
          );
        }
      });
    }

    throw error;
  }
}

/** 清理超时上传任务。 */
export async function cleanupExpiredUpload(
  socket: WebSocket,
): Promise<void> {
  const upload = uploads.get(socket);

  if (
    upload &&
    Date.now() - upload.lastActivity >= UPLOAD_TIMEOUT_MS
  ) {
    await cancelUpload(socket);
  }
}
