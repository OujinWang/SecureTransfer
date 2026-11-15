
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import AuthPanel from "./components/AuthPanel.vue";
import { SecureTransferClient } from "./ws/client";

const connected = ref(false);
const status = ref("正在连接");

const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const url = `${protocol}//${window.location.host}/ws`;

const client = new SecureTransferClient(url);

client.onClose = () => {
  connected.value = false;
  status.value = "连接已断开";
};

onMounted(async () => {
  try {
    await client.connect();

    const result = await client.request("system.ping", {});

    if (
      typeof result !== "object" ||
      result === null ||
      !("message" in result) ||
      result.message !== "pong"
    ) {
      throw new Error("Invalid server response");
    }

    connected.value = true;
    status.value = "已连接";
  } catch {
    connected.value = false;
    status.value = "连接失败";
  }
});

onUnmounted(() => {
  client.close();
});
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="nav-content">
        <a class="brand" href="/" aria-label="SecureTransfer 首页">
          SecureTransfer
        </a>

        <div class="connection-status" role="status">
          <span
            class="status-dot"
            :class="{ online: connected }"
          ></span>
          <span>{{ status }}</span>
        </div>
      </div>
    </header>

    <main class="main-content">
      <div class="page-heading">
        <h1>安全传输，简单可靠。</h1>
        <p>集中管理文件，轻松与他人共享。</p>
      </div>

      <AuthPanel
        :client="client"
        :disabled="!connected"
      />
    </main>

    <footer class="footer">
      © 2026 SecureTransfer
    </footer>
  </div>
</template>

<style>
:root {
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "SF Pro Display",
    "SF Pro Text",
    "Segoe UI",
    "PingFang SC",
    "Microsoft YaHei",
    sans-serif;

  color: #1d1d1f;
  background: #f5f5f7;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}

* {
  box-sizing: border-box;
}

html,
body,
#app {
  width: 100%;
  min-width: 320px;
  min-height: 100%;
  margin: 0;
}

body {
  display: block;
  min-height: 100vh;
  background: #f5f5f7;
}

#app {
  max-width: none;
  padding: 0;
  margin: 0;
  text-align: left;
}

button,
input {
  font: inherit;
}

button {
  cursor: pointer;
}

.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* 顶部导航栏 */
.topbar {
  height: 68px;
  background: rgba(255, 255, 255, 0.88);
  border-bottom: 1px solid #e9e9ec;
}

.nav-content {
  width: min(100% - 48px, 1120px);
  height: 100%;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 11px;
  color: #1d1d1f;
  text-decoration: none;
  font-size: 17px;
  font-weight: 650;
  letter-spacing: -0.5px;
}

.brand-icon {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  color: #ffffff;
  background: #1d1d1f;
  border-radius: 9px;
}

.brand-icon svg {
  width: 21px;
  height: 21px;
}

.connection-status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #86868b;
  font-size: 12px;
  font-weight: 500;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #c7c7cc;
}

.status-dot.online {
  background: #55555a;
}

/* 主体区域 */
.main-content {
  flex: 1;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 76px 24px 80px;
}

.page-heading {
  margin-bottom: 32px;
  text-align: center;
}

.page-heading h1 {
  margin: 0;
  color: #1d1d1f;
  font-size: clamp(25px, 3vw, 30px);
  font-weight: 600;
  letter-spacing: -0.8px;
  line-height: 1.35;
}

.page-heading p {
  margin: 10px 0 0;
  color: #6e6e73;
  font-size: 14px;
  line-height: 1.6;
}

/* 页脚 */
.footer {
  padding: 24px;
  color: #a1a1a6;
  text-align: center;
  font-size: 12px;
}

@media (max-width: 600px) {
  .topbar {
    height: 60px;
  }

  .nav-content {
    width: calc(100% - 32px);
  }

  .brand {
    font-size: 15px;
  }

  .main-content {
    padding: 56px 16px 64px;
  }

  .page-heading {
    margin-bottom: 28px;
  }

  .page-heading h1 {
    letter-spacing: -0.8px;
  }

  .page-heading p {
    font-size: 14px;
  }
}
</style>
