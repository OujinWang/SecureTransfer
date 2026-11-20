export const PROTOCOL_VERSION = 1 as const;

export const FILE_CHUNK_SIZE = 32 * 1024;
export const MAX_FILE_SIZE = 100 * 1024 * 1024;

export interface RequestEnvelope<TPayload = unknown> {
  version: typeof PROTOCOL_VERSION;
  type: "request";
  id: string;
  action: string;
  payload: TPayload;
}

export interface ResponseEnvelope<TPayload = unknown> {
  version: typeof PROTOCOL_VERSION;
  type: "response";
  id: string;
  ok: boolean;
  payload?: TPayload;
  error?: {
    code: string;
    message: string;
  };
}

export interface HealthPayload {
  status: "ok";
  service: "secure-transfer-server";
}

/** 已完成上传的文件元数据。 */
export interface FileMetadata {
  id: string;
  originalName: string;
  size: number;
  sha256: string;
  createdAt: string;
}

export interface SharedFileMetadata extends FileMetadata {
  ownerUsername: string;
}

export interface GrantedFileShare {
  fileId: string;
  originalName: string;
  recipientUsername: string;
  createdAt: string;
}

/** 初始化文件上传。 */
export interface FileUploadInitPayload {
  name: string;
  size: number;
  sha256: string;
}

export interface FileUploadInitResult {
  transferId: string;
  chunkSize: number;
}

/** 完成或取消文件上传。 */
export interface FileTransferPayload {
  transferId: string;
}

/** 上传完成后的文件信息。 */
export interface FileUploadCompleteResult {
  file: FileMetadata;
}

/** 查询当前用户的文件列表。 */
export interface FileListResult {
  files: FileMetadata[];
}

/** 初始化文件下载。 */
export interface FileDownloadInitPayload {
  fileId: string;
}

export interface FileDownloadInitResult {
  transferId: string;
  file: FileMetadata;
  chunkSize: number;
}

/** 删除文件。 */
export interface FileDeletePayload {
  fileId: string;
}
