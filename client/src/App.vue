<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { HealthPayload, ResponseEnvelope } from "@secure-transfer/shared";

const status = ref("正在连接本地服务…");
const connected = ref(false);

onMounted(async () => {
  try {
    const response = await fetch("/api/health");
    const message = (await response.json()) as ResponseEnvelope<HealthPayload>;
    if (!response.ok || !message.ok || message.payload?.status !== "ok") {
      throw new Error("服务返回异常");
    }
    connected.value = true;
    status.value = "前后端通信正常";
  } catch {
    status.value = "无法连接后端，请确认服务已启动";
  }
});
</script>

<template>
  <main class="shell">
    <section class="card">
      <div class="eyebrow">SECURETRANSFER</div>
      <h1>安全文件传输</h1>
      <p class="intro">安全、可靠的多用户文件传输服务。</p>
      <div class="status" :class="{ online: connected }">
        <span class="dot" />{{ status }}
      </div>
      <div class="meta"><span>前端</span><strong>Vue 3 + TypeScript</strong></div>
      <div class="meta"><span>协议</span><strong>Shared envelope v1</strong></div>
    </section>
  </main>
</template>
