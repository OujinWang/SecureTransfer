
import { db } from "../db.js";

import type {
  GrantedFileShare,
  SharedFileMetadata,
} from "@secure-transfer/shared";

interface UserRow {
  id: string;
  username: string;
}

interface OwnedFileRow {
  id: string;
}

interface ReceivedShareRow {
  id: string;
  original_name: string;
  size: number;
  sha256: string;
  created_at: string;
  owner_username: string;
}

interface GrantedShareRow {
  file_id: string;
  original_name: string;
  recipient_username: string;
  created_at: string;
}

export class ShareError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ShareError";
  }
}

/** 确认当前用户是文件所有者。 */
function assertFileOwner(
  ownerId: string,
  fileId: string,
): void {
  const file = db.prepare(`
    SELECT id
    FROM files
    WHERE id = ? AND owner_id = ?
  `).get(fileId, ownerId) as OwnedFileRow | undefined;

  if (!file) {
    throw new ShareError(
      "FILE_NOT_FOUND",
      "File not found",
    );
  }
}

/** 授权指定用户访问文件。 */
export function grantFileShare(
  ownerId: string,
  fileId: string,
  recipientUsername: string,
): { recipientUsername: string } {
  const username = recipientUsername.trim();

  if (!username || username.length > 64) {
    throw new ShareError(
      "INVALID_RECIPIENT",
      "Invalid recipient username",
    );
  }

  assertFileOwner(ownerId, fileId);

  const recipient = db.prepare(`
    SELECT id, username
    FROM users
    WHERE username = ?
  `).get(username) as UserRow | undefined;

  if (!recipient) {
    throw new ShareError(
      "USER_NOT_FOUND",
      "Recipient user not found",
    );
  }

  if (recipient.id === ownerId) {
    throw new ShareError(
      "INVALID_RECIPIENT",
      "Cannot share a file with yourself",
    );
  }

  db.prepare(`
    INSERT OR IGNORE INTO file_shares (
      file_id,
      recipient_id
    )
    VALUES (?, ?)
  `).run(fileId, recipient.id);

  return {
    recipientUsername: recipient.username,
  };
}

/** 撤销指定用户对文件的访问权限。 */
export function revokeFileShare(
  ownerId: string,
  fileId: string,
  recipientUsername: string,
): boolean {
  assertFileOwner(ownerId, fileId);

  const result = db.prepare(`
    DELETE FROM file_shares
    WHERE file_id = ?
      AND recipient_id = (
        SELECT id
        FROM users
        WHERE username = ?
      )
  `).run(fileId, recipientUsername);

  return result.changes > 0;
}

/** 列出其他用户共享给当前用户的文件。 */
export function listReceivedShares(
  recipientId: string,
): SharedFileMetadata[] {
  const rows = db.prepare(`
    SELECT
      f.id,
      f.original_name,
      f.size,
      f.sha256,
      f.created_at,
      u.username AS owner_username
    FROM file_shares AS s
    JOIN files AS f ON f.id = s.file_id
    JOIN users AS u ON u.id = f.owner_id
    WHERE s.recipient_id = ?
    ORDER BY s.created_at DESC, f.id DESC
  `).all(recipientId) as ReceivedShareRow[];

  return rows.map((row) => ({
    id: row.id,
    originalName: row.original_name,
    size: row.size,
    sha256: row.sha256,
    createdAt: row.created_at,
    ownerUsername: row.owner_username,
  }));
}

/** 列出当前用户已授予的共享权限。 */
export function listGrantedShares(
  ownerId: string,
): GrantedFileShare[] {
  const rows = db.prepare(`
    SELECT
      s.file_id,
      f.original_name,
      u.username AS recipient_username,
      s.created_at
    FROM file_shares AS s
    JOIN files AS f ON f.id = s.file_id
    JOIN users AS u ON u.id = s.recipient_id
    WHERE f.owner_id = ?
    ORDER BY s.created_at DESC, s.file_id DESC
  `).all(ownerId) as GrantedShareRow[];

  return rows.map((row) => ({
    fileId: row.file_id,
    originalName: row.original_name,
    recipientUsername: row.recipient_username,
    createdAt: row.created_at,
  }));
}
