
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type {
  FileMetadata,
  GrantedFileShare,
  SharedFileMetadata,
} from "@secure-transfer/shared";
import type { SecureTransferClient } from "../ws/client";

const props = defineProps<{
  client: SecureTransferClient;
}>();

type WorkspaceTab = "mine" | "received";

const activeTab = ref<WorkspaceTab>("mine");

const files = ref<FileMetadata[]>([]);
const receivedFiles = ref<SharedFileMetadata[]>([]);
const grantedShares = ref<GrantedFileShare[]>([]);

const loading = ref(false);
const uploading = ref(false);
const uploadProgress = ref(0);
const downloadingId = ref<string | null>(null);
const downloadProgress = ref(0);
const deletingId = ref<string | null>(null);

const shareEditorId = ref<string | null>(null);
const recipientUsername = ref("");
const granting = ref(false);
const revokingKey = ref<string | null>(null);

const errorMessage = ref("");
const successMessage = ref("");
const fileInput = ref<HTMLInputElement | null>(null);

const visibleFiles = computed(() =>
  activeTab.value === "mine" ? files.value : receivedFiles.value,
);

function isSharedFile(
  file: FileMetadata | SharedFileMetadata,
): file is SharedFileMetadata {
  return "ownerUsername" in file;
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function clearFeedback(): void {
  errorMessage.value = "";
  successMessage.value = "";
}

function grantsForFile(fileId: string): GrantedFileShare[] {
  return grantedShares.value.filter(
    (share) => share.fileId === fileId,
  );
}

async function refreshMine(): Promise<void> {
  const [ownFiles, shares] = await Promise.all([
    props.client.listFiles(),
    props.client.listGrantedShares(),
  ]);

  files.value = ownFiles;
  grantedShares.value = shares;
}

async function refreshReceived(): Promise<void> {
  receivedFiles.value = await props.client.listReceivedShares();
}

async function refreshCurrentTab(): Promise<void> {
  loading.value = true;

  try {
    if (activeTab.value === "mine") {
      await refreshMine();
    } else {
      await refreshReceived();
    }
  } catch {
    errorMessage.value = "获取文件列表失败，请稍后重试。";
  } finally {
    loading.value = false;
  }
}

function switchTab(tab: WorkspaceTab): void {
  if (activeTab.value === tab) return;

  activeTab.value = tab;
  shareEditorId.value = null;
  recipientUsername.value = "";
  clearFeedback();

  void refreshCurrentTab();
}

function selectFile(): void {
  fileInput.value?.click();
}

async function handleFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (!file || uploading.value) return;

  uploading.value = true;
  uploadProgress.value = 0;
  clearFeedback();

  try {
    const uploaded = await props.client.uploadFile(
      file,
      (percent) => {
        uploadProgress.value = percent;
      },
    );

    successMessage.value =
      `文件「${uploaded.originalName}」上传成功。`;

    await refreshMine();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    errorMessage.value =
      message === "File exceeds 100 MiB limit"
        ? "单个文件不能超过 100 MiB。"
        : "上传失败，请检查网络连接后重试。";
  } finally {
    uploading.value = false;
    input.value = "";
  }
}

async function handleDownload(
  file: FileMetadata | SharedFileMetadata,
): Promise<void> {
  if (downloadingId.value) return;

  downloadingId.value = file.id;
  downloadProgress.value = 0;
  clearFeedback();

  try {
    await props.client.downloadFile(file.id, (percent) => {
      downloadProgress.value = percent;
    });

    successMessage.value =
      `文件「${file.originalName}」下载完成。`;
  } catch {
    errorMessage.value =
      "下载失败。文件可能已被删除、共享已撤销，或网络连接中断。";
  } finally {
    downloadingId.value = null;
  }
}

async function handleDelete(file: FileMetadata): Promise<void> {
  if (deletingId.value) return;

  const confirmed = window.confirm(
    `确定永久删除「${file.originalName}」吗？\n删除后无法恢复，相关共享权限也会失效。`,
  );

  if (!confirmed) return;

  deletingId.value = file.id;
  clearFeedback();

  try {
    await props.client.deleteFile(file.id);

    files.value = files.value.filter(
      (item) => item.id !== file.id,
    );

    grantedShares.value = grantedShares.value.filter(
      (share) => share.fileId !== file.id,
    );

    if (shareEditorId.value === file.id) {
      shareEditorId.value = null;
    }

    successMessage.value =
      `文件「${file.originalName}」已删除。`;
  } catch {
    errorMessage.value = "删除失败，请稍后重试。";
  } finally {
    deletingId.value = null;
  }
}

function toggleShare(fileId: string): void {
  if (shareEditorId.value === fileId) {
    shareEditorId.value = null;
  } else {
    shareEditorId.value = fileId;
  }

  recipientUsername.value = "";
  clearFeedback();
}

async function handleGrant(fileId: string): Promise<void> {
  const username = recipientUsername.value.trim();

  if (!username || granting.value) return;

  granting.value = true;
  clearFeedback();

  try {
    const actualUsername = await props.client.grantFileShare(
      fileId,
      username,
    );

    grantedShares.value =
      await props.client.listGrantedShares();

    recipientUsername.value = "";
    successMessage.value =
      `已向用户「${actualUsername}」授予文件访问权限。`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (message === "Recipient user not found") {
      errorMessage.value = "用户不存在，请检查用户名。";
    } else if (message === "Cannot share a file with yourself") {
      errorMessage.value = "不能将文件共享给自己。";
    } else {
      errorMessage.value = "共享失败，请检查用户名后重试。";
    }
  } finally {
    granting.value = false;
  }
}

async function handleRevoke(
  share: GrantedFileShare,
): Promise<void> {
  const key = `${share.fileId}:${share.recipientUsername}`;

  if (revokingKey.value) return;

  const confirmed = window.confirm(
    `确定撤销用户「${share.recipientUsername}」对「${share.originalName}」的访问权限吗？`,
  );

  if (!confirmed) return;

  revokingKey.value = key;
  clearFeedback();

  try {
    await props.client.revokeFileShare(
      share.fileId,
      share.recipientUsername,
    );

    grantedShares.value = grantedShares.value.filter(
      (item) =>
        !(
          item.fileId === share.fileId &&
          item.recipientUsername === share.recipientUsername
        ),
    );

    successMessage.value =
      `已撤销用户「${share.recipientUsername}」的访问权限。`;
  } catch {
    errorMessage.value = "撤销共享失败，请稍后重试。";
  } finally {
    revokingKey.value = null;
  }
}

onMounted(() => {
  void refreshCurrentTab();
});
</script>

<template>
  <section class="file-workspace">
    <div class="workspace-header">
      <div>
        <h1>文件管理</h1>
        <p>安全存储、传输和共享你的文件</p>
      </div>

      <button
        v-if="activeTab === 'mine'"
        class="upload-button"
        type="button"
        :disabled="uploading"
        @click="selectFile"
      >
        {{ uploading ? "正在上传…" : "上传文件" }}
      </button>

      <input
        ref="fileInput"
        class="file-input"
        type="file"
        :disabled="uploading"
        @change="handleFileChange"
      />
    </div>

    <div class="workspace-tabs" role="tablist" aria-label="文件分类">
      <button
        class="tab-button"
        :class="{ active: activeTab === 'mine' }"
        type="button"
        role="tab"
        :aria-selected="activeTab === 'mine'"
        @click="switchTab('mine')"
      >
        我的文件
      </button>

      <button
        class="tab-button"
        :class="{ active: activeTab === 'received' }"
        type="button"
        role="tab"
        :aria-selected="activeTab === 'received'"
        @click="switchTab('received')"
      >
        共享给我
      </button>
    </div>

    <div
      v-if="uploading"
      class="upload-status"
      role="status"
    >
      <div class="progress-label">
        <span>正在上传文件</span>
        <span>{{ uploadProgress }}%</span>
      </div>

      <div
        class="progress-track"
        role="progressbar"
        :aria-valuenow="uploadProgress"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-label="文件上传进度"
      >
        <div
          class="progress-fill"
          :style="{ width: `${uploadProgress}%` }"
        />
      </div>
    </div>

    <p
      v-if="errorMessage"
      class="file-feedback error"
      role="alert"
    >
      {{ errorMessage }}
    </p>

    <p
      v-if="successMessage"
      class="file-feedback success"
      role="status"
    >
      {{ successMessage }}
    </p>

    <div class="files-panel">
      <div class="panel-header">
        <h2>
          {{
            activeTab === "mine"
              ? "我的文件"
              : "共享给我的文件"
          }}
        </h2>

        <span>{{ visibleFiles.length }} 个文件</span>
      </div>

      <div v-if="loading" class="empty-state">
        正在加载文件…
      </div>

      <div
        v-else-if="visibleFiles.length === 0"
        class="empty-state"
      >
        <h3>
          {{
            activeTab === "mine"
              ? "还没有文件"
              : "暂无共享文件"
          }}
        </h3>

        <p>
          {{
            activeTab === "mine"
              ? "点击右上角的“上传文件”开始使用。"
              : "其他用户共享给你的文件将显示在这里。"
          }}
        </p>
      </div>

      <div v-else class="file-list">
        <div
          v-for="file in visibleFiles"
          :key="file.id"
          class="file-item"
        >
          <div class="file-row">
            <div class="file-icon" aria-hidden="true">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path
                  d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                />
                <path d="M14 2v6h6" />
                <path d="M8 13h8" />
                <path d="M8 17h8" />
              </svg>
            </div>

            <div class="file-details">
              <div class="file-name">
                {{ file.originalName }}
              </div>

              <div class="file-meta">
                {{ formatSize(file.size) }}
                ·
                {{
                  new Date(file.createdAt).toLocaleString("zh-CN")
                }}
              </div>

              <div
                v-if="isSharedFile(file)"
                class="file-owner"
              >
                来自 {{ file.ownerUsername }}
              </div>
            </div>

            <div class="file-actions">
              <button
                class="action-button"
                type="button"
                :disabled="downloadingId !== null"
                :aria-label="`下载 ${file.originalName}`"
                @click="handleDownload(file)"
              >
                {{
                  downloadingId === file.id
                    ? `下载中 ${downloadProgress}%`
                    : "下载"
                }}
              </button>

              <template v-if="activeTab === 'mine'">
                <button
                  class="action-button"
                  :class="{
                    selected: shareEditorId === file.id,
                  }"
                  type="button"
                  :aria-expanded="shareEditorId === file.id"
                  @click="toggleShare(file.id)"
                >
                  共享
                </button>

                <button
                  class="action-button danger"
                  type="button"
                  :disabled="
                    deletingId !== null ||
                    downloadingId !== null ||
                    uploading
                  "
                  @click="handleDelete(file)"
                >
                  {{
                    deletingId === file.id
                      ? "删除中…"
                      : "删除"
                  }}
                </button>
              </template>
            </div>
          </div>

          <div
            v-if="
              activeTab === 'mine' &&
              shareEditorId === file.id
            "
            class="share-panel"
          >
            <div class="share-heading">
              <h3>共享文件</h3>
              <p>输入已注册用户的用户名，授予下载权限。</p>
            </div>

            <form
              class="share-form"
              @submit.prevent="handleGrant(file.id)"
            >
              <input
                v-model="recipientUsername"
                class="share-input"
                type="text"
                placeholder="接收者用户名"
                aria-label="接收者用户名"
                maxlength="64"
                autocomplete="off"
                required
                :disabled="granting"
              />

              <button
                class="share-submit"
                type="submit"
                :disabled="
                  granting ||
                  !recipientUsername.trim()
                "
              >
                {{
                  granting
                    ? "授权中…"
                    : "授权访问"
                }}
              </button>
            </form>

            <div class="share-grants">
              <h4>
                已共享给
                {{ grantsForFile(file.id).length }}
                位用户
              </h4>

              <p
                v-if="grantsForFile(file.id).length === 0"
                class="share-empty"
              >
                暂无共享记录
              </p>

              <div
                v-for="share in grantsForFile(file.id)"
                :key="share.recipientUsername"
                class="share-grant-row"
              >
                <div class="recipient-info">
                  <span class="recipient-name">
                    {{ share.recipientUsername }}
                  </span>
                  <span class="recipient-date">
                    {{
                      new Date(
                        share.createdAt,
                      ).toLocaleString("zh-CN")
                    }}
                  </span>
                </div>

                <button
                  class="revoke-button"
                  type="button"
                  :disabled="revokingKey !== null"
                  @click="handleRevoke(share)"
                >
                  {{
                    revokingKey ===
                    `${share.fileId}:${share.recipientUsername}`
                      ? "撤销中…"
                      : "撤销共享"
                  }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.file-workspace {
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
}

.workspace-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 28px;
}

.workspace-header h1 {
  margin: 0 0 8px;
  font-size: 28px;
  font-weight: 650;
  letter-spacing: -0.8px;
}

.workspace-header p {
  margin: 0;
  color: #86868b;
  font-size: 14px;
}

.upload-button,
.share-submit {
  flex-shrink: 0;
  min-height: 42px;
  padding: 0 22px;
  color: #fff;
  background: #1d1d1f;
  border: none;
  border-radius: 9px;
  font-size: 14px;
  font-weight: 600;
}

.upload-button:hover:not(:disabled),
.share-submit:hover:not(:disabled) {
  background: #38383c;
}

.upload-button:disabled,
.share-submit:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.file-input {
  display: none;
}

.workspace-tabs {
  display: flex;
  gap: 28px;
  margin-bottom: 22px;
  border-bottom: 1px solid #dedee2;
}

.tab-button {
  position: relative;
  padding: 0 2px 15px;
  color: #86868b;
  background: transparent;
  border: none;
  font-size: 14px;
  font-weight: 550;
}

.tab-button:hover {
  color: #1d1d1f;
}

.tab-button.active {
  color: #1d1d1f;
  font-weight: 650;
}

.tab-button.active::after {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  background: #1d1d1f;
  content: "";
}

.upload-status {
  margin-bottom: 20px;
  padding: 18px 20px;
  background: #fff;
  border: 1px solid #e9e9ec;
  border-radius: 12px;
}

.progress-label {
  display: flex;
  justify-content: space-between;
  margin-bottom: 12px;
  font-size: 13px;
}

.progress-track {
  height: 6px;
  overflow: hidden;
  background: #e9e9ec;
  border-radius: 999px;
}

.progress-fill {
  height: 100%;
  background: #1d1d1f;
  border-radius: inherit;
  transition: width 0.15s ease;
}

.file-feedback {
  margin: 0 0 16px;
  padding: 12px 16px;
  border-radius: 9px;
  font-size: 13px;
}

.file-feedback.error {
  color: #a33340;
  background: #fff0f1;
}

.file-feedback.success {
  color: #23734d;
  background: #edf8f1;
}

.files-panel {
  overflow: hidden;
  background: #fff;
  border: 1px solid #e9e9ec;
  border-radius: 14px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 22px 24px;
  border-bottom: 1px solid #f0f0f2;
}

.panel-header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.panel-header span {
  color: #86868b;
  font-size: 13px;
}

.empty-state {
  padding: 72px 24px;
  color: #86868b;
  text-align: center;
  font-size: 14px;
}

.empty-state h3 {
  margin: 0 0 8px;
  color: #1d1d1f;
  font-size: 16px;
  font-weight: 600;
}

.empty-state p {
  margin: 0;
}

.file-item {
  border-bottom: 1px solid #f0f0f2;
}

.file-item:last-child {
  border-bottom: none;
}

.file-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 24px;
}

.file-icon {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 42px;
  height: 42px;
  color: #515154;
  background: #f5f5f7;
  border-radius: 10px;
}

.file-details {
  flex: 1;
  min-width: 0;
}

.file-name {
  overflow-wrap: anywhere;
  font-size: 14px;
  font-weight: 550;
}

.file-meta,
.file-owner {
  margin-top: 5px;
  color: #86868b;
  font-size: 12px;
}

.file-owner {
  color: #515154;
}

.file-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
}

.action-button {
  flex-shrink: 0;
  padding: 8px 14px;
  color: #1d1d1f;
  background: #f5f5f7;
  border: 1px solid #e9e9ec;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
}

.action-button:hover:not(:disabled),
.action-button.selected {
  background: #e9e9ec;
}

.action-button.danger {
  color: #a33340;
  background: transparent;
}

.action-button.danger:hover:not(:disabled) {
  background: #fff0f1;
  border-color: #f1d1d5;
}

.action-button:disabled,
.revoke-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.share-panel {
  padding: 22px 24px 24px 82px;
  background: #fafafa;
  border-top: 1px solid #f0f0f2;
}

.share-heading h3 {
  margin: 0 0 6px;
  font-size: 14px;
  font-weight: 600;
}

.share-heading p {
  margin: 0;
  color: #86868b;
  font-size: 12px;
  line-height: 1.6;
}

.share-form {
  display: flex;
  gap: 10px;
  margin-top: 18px;
}

.share-input {
  flex: 1;
  min-width: 0;
  height: 42px;
  padding: 0 14px;
  color: #1d1d1f;
  background: #fff;
  border: 1px solid #dedee2;
  border-radius: 8px;
  outline: none;
  font-size: 13px;
}

.share-input:focus {
  border-color: #86868b;
}

.share-submit {
  min-height: 42px;
  font-size: 13px;
}

.share-grants {
  margin-top: 24px;
}

.share-grants h4 {
  margin: 0 0 12px;
  color: #515154;
  font-size: 12px;
  font-weight: 600;
}

.share-empty {
  margin: 0;
  color: #86868b;
  font-size: 12px;
}

.share-grant-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 0;
  border-top: 1px solid #ebebed;
}

.recipient-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.recipient-name {
  overflow-wrap: anywhere;
  font-size: 13px;
  font-weight: 550;
}

.recipient-date {
  color: #86868b;
  font-size: 11px;
}

.revoke-button {
  flex-shrink: 0;
  padding: 7px 10px;
  color: #a33340;
  background: transparent;
  border: 1px solid #e9e9ec;
  border-radius: 7px;
  font-size: 12px;
}

.revoke-button:hover:not(:disabled) {
  background: #fff0f1;
}

@media (max-width: 600px) {
  .workspace-header {
    align-items: flex-start;
    gap: 16px;
  }

  .workspace-header h1 {
    font-size: 24px;
  }

  .upload-button {
    padding: 0 14px;
  }

  .panel-header {
    padding: 18px 16px;
  }

  .file-row {
    flex-wrap: wrap;
    padding: 16px;
  }

  .file-actions {
    width: 100%;
    justify-content: flex-end;
  }

  .share-panel {
    padding: 20px 16px;
  }

  .share-form {
    flex-direction: column;
  }

  .share-submit {
    width: 100%;
  }
}
</style>
