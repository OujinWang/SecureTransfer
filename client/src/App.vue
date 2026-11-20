
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import AuthPanel from "./components/AuthPanel.vue";
import { SecureTransferClient } from "./ws/client";
import FileWorkspace from "./components/FileWorkspace.vue";

const connected = ref(false);

interface AuthenticatedUser {
  id: string;
  username: string;
}

const currentUser = ref<AuthenticatedUser | null>(null);
const loggingOut = ref(false);
const logoutError = ref("");

const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const url = `${protocol}//${window.location.host}/ws`;

const client = new SecureTransferClient(url);

client.onClose = () => {
  connected.value = false;
  currentUser.value = null;
};

/** 更新当前连接的登录用户。 */
function handleAuthenticated(user: AuthenticatedUser): void {
  currentUser.value = user;
  logoutError.value = "";
}

/** 退出当前登录会话。 */
async function handleLogout(): Promise<void> {
  if (loggingOut.value || !connected.value) {
    return;
  }

  loggingOut.value = true;
  logoutError.value = "";

  try {
    await client.request("auth.logout", {});
    currentUser.value = null;
  } catch {
    logoutError.value = "退出登录失败，请重试。";
  } finally {
    loggingOut.value = false;
  }
}

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

    const restoredUser = await client.restoreSession();

    if (restoredUser) {
      currentUser.value = restoredUser;
    }
  } catch {
    connected.value = false;
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

        <div class="nav-actions">

          <template v-if="currentUser">

            <span class="nav-username">
              {{ currentUser.username }}
            </span>

            <button
              class="logout-button"
              type="button"
              :disabled="loggingOut || !connected"
              @click="handleLogout"
            >
              {{ loggingOut ? "退出中…" : "退出登录" }}
            </button>
          </template>
        </div>

      </div>
    </header>

    <main
      class="main-content"
      :class="{ 'workspace-layout': currentUser }"
    >
      <FileWorkspace
        v-if="currentUser"
        :client="client"
      />

      <template v-else>
        <div class="page-heading">
          <h1>安全传输，简单可靠。</h1>
          <p>集中管理文件，轻松与他人共享。</p>
        </div>

        <AuthPanel
          :client="client"
          :disabled="!connected"
          @authenticated="handleAuthenticated"
        />
      </template>
    </main>

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
  width: 100%;
  height: 100%;
  padding: 0 24px;
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

/* 主体区域 */
.main-content {
  flex: 1;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
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

@media (max-width: 600px) {
  .topbar {
    height: 60px;
  }

  .nav-content {
    padding: 0 16px;
  }

  .brand {
    font-size: 15px;
  }

  .main-content {
    padding: 24px 16px;
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

/* 顶部用户操作区 */
.nav-actions {
  display: flex;
  align-items: center;
  gap: 18px;
}

.nav-username {
  color: #1d1d1f;
  font-size: 13px;
  font-weight: 600;
}

.logout-button {
  padding: 8px 12px;
  color: #6e6e73;
  background: transparent;
  border: 1px solid #e5e5e7;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
}

.logout-button:hover:not(:disabled) {
  color: #1d1d1f;
  background: #f5f5f7;
}

.logout-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 文件管理页面 */
.main-content.workspace-layout {
  align-items: stretch;
  justify-content: flex-start;
  padding-top: 52px;
}

@media (max-width: 600px) {
  .nav-actions {
    gap: 10px;
  }

  .nav-username {
    max-width: 90px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .main-content.workspace-layout {
    padding-top: 36px;
  }
}

</style>
