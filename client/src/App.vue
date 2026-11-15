<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { SecureTransferClient } from "./ws/client";

const status = ref("正在连接服务器…");
const connected = ref(false);

const scheme = window.location.protocol === "https:" ? "wss" : "ws";
const url = `${scheme}://${window.location.host}/ws`;

const client = new SecureTransferClient(url);

client.onClose = () => {
  connected.value = false;
  status.value = "服务器连接已断开";
};

onMounted(async () => {
  try {
    await client.connect();

    const payload = await client.request("system.ping", {});

    if (
      typeof payload !== "object" ||
      payload === null ||
      !("message" in payload) ||
      payload.message !== "pong"
    ) {
      throw new Error("Invalid ping response");
    }

    connected.value = true;
    status.value = "服务器已连接";
  } catch {
    connected.value = false;
    status.value = "服务器连接失败";
  }
});

onUnmounted(() => {
  client.close();
});
</script>

<template>
  <main class="shell">
    <section class="card">
      <div class="eyebrow">Secure Transfer</div>
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
