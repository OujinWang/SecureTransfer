
<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { FileMetadata } from "@secure-transfer/shared";
import type { SecureTransferClient } from "../ws/client";

const props = defineProps<{
  client: SecureTransferClient;
}>();

const files = ref<FileMetadata[]>([]);
const loading = ref(false);
const uploading = ref(false);
const progress = ref(0);
const errorMessage = ref("");
const successMessage = ref("");
const fileInput = ref<HTMLInputElement | null>(null);

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

async function refreshFiles(): Promise<void> {
  loading.value = true;

  try {
    files.value = await props.client.listFiles();
  } catch {
    errorMessage.value = "无法获取文件列表，请检查服务器连接。";
  } finally {
    loading.value = false;
  }
}

function selectFile(): void {
  fileInput.value?.click();
}

async function handleFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (!file || uploading.value) return;

  uploading.value = true;
  progress.value = 0;
  errorMessage.value = "";
  successMessage.value = "";

  try {
    const uploaded = await props.client.uploadFile(
      file,
      (percent) => {
        progress.value = percent;
      },
    );

    successMessage.value = `文件「${uploaded.originalName}」上传成功。`;
    await refreshFiles();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    errorMessage.value =
      message === "File exceeds 100 MiB limit"
        ? "单个文件不能超过 100 MiB。"
        : "上传失败，请检查网络连接或文件内容后重试。";
  } finally {
    uploading.value = false;
    input.value = "";
  }
}

onMounted(() => {
  void refreshFiles();
});
</script>

<template>
  <section class="file-workspace">
    <div class="workspace-header">
      <div>
        <h1>我的文件</h1>
      </div>

      <button
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

    <div v-if="uploading" class="upload-status" role="status">
      <div class="progress-label">
        <span>正在上传文件</span>
        <span>{{ progress }}%</span>
      </div>
      <div
        class="progress-track"
        role="progressbar"
        :aria-valuenow="progress"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-label="文件上传进度"
      >
        <div
          class="progress-fill"
          :style="{ width: `${progress}%` }"
        />
      </div>
    </div>

    <p v-if="errorMessage" class="file-feedback error" role="alert">
      {{ errorMessage }}
    </p>

    <p v-if="successMessage" class="file-feedback success" role="status">
      {{ successMessage }}
    </p>

    <div class="files-panel">
      <div class="panel-header">
        <h2>文件列表</h2>
        <span>{{ files.length }} 个文件</span>
      </div>

      <div v-if="loading" class="empty-state">
        正在加载文件…
      </div>

      <div v-else-if="files.length === 0" class="empty-state">
        <h3>还没有文件</h3>
        <p>点击右上角的“上传文件”开始使用。</p>
      </div>

      <div v-else class="file-list">
        <div
          v-for="file in files"
          :key="file.id"
          class="file-row"
        >
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
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
                <path d="M8 13h8" />
                <path d="M8 17h8" />
            </svg>
            </div>

          <div class="file-details">
            <div class="file-name">{{ file.originalName }}</div>
            <div class="file-meta">
              {{ formatSize(file.size) }}
              ·
              {{ new Date(file.createdAt).toLocaleString("zh-CN") }}
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
  margin-bottom: 32px;
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

.upload-button {
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

.upload-button:hover:not(:disabled) {
  background: #38383c;
}

.upload-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.file-input {
  display: none;
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

.file-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 24px;
  border-bottom: 1px solid #f0f0f2;
}

.file-row:last-child {
  border-bottom: none;
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
  min-width: 0;
}

.file-name {
  overflow-wrap: anywhere;
  font-size: 14px;
  font-weight: 550;
}

.file-meta {
  margin-top: 5px;
  color: #86868b;
  font-size: 12px;
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

  .panel-header,
  .file-row {
    padding-left: 16px;
    padding-right: 16px;
  }
}
</style>
