<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { PROTOCOL_VERSION } from "@secure-transfer/shared";
import type {
  RequestEnvelope,
  ResponseEnvelope,
} from "@secure-transfer/shared";

const status = ref("正在连接服务器…");
const connected = ref(false);

let socket: WebSocket | null = null;

onMounted(() => {
  // 根据页面协议自动选择 ws 或 wss。
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  const url = `${scheme}://${window.location.host}/ws`;

  socket = new WebSocket(url);

  socket.onopen = () => {
    const request: RequestEnvelope = {
      version: PROTOCOL_VERSION,
      type: "request",
      id: crypto.randomUUID(),
      action: "system.ping",
      payload: {},
    };

    socket?.send(JSON.stringify(request));
  };

  socket.onmessage = (event) => {
    try {
      const response = JSON.parse(event.data) as ResponseEnvelope<{
        message: string;
      }>;

      if (
        response.version === PROTOCOL_VERSION &&
        response.type === "response" &&
        response.ok &&
        response.payload?.message === "pong"
      ) {
        connected.value = true;
        status.value = "服务器已连接";
      } else {
        status.value = "服务器响应异常";
      }
    } catch {
      status.value = "无法解析服务器响应";
    }
  };

  socket.onerror = () => {
    connected.value = false;
    status.value = "服务器连接失败";
  };

  socket.onclose = () => {
    connected.value = false;
    status.value = "服务器连接已断开";
  };
});

onUnmounted(() => {
  socket?.close();
  socket = null;
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
