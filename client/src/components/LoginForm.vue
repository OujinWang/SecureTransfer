<script setup lang="ts">
import { ref } from "vue";
import type { SecureTransferClient } from "../ws/client";

const props = defineProps<{
  client: SecureTransferClient;
  disabled: boolean;
}>();

const username = ref("");
const password = ref("");
const showPassword = ref(false);
const submitting = ref(false);

const emit = defineEmits<{
  authenticated: [
    user: { id: string; username: string; isVip: boolean }
  ];
}>();

const errorMessage = ref("");

/** 校验登录表单并提交身份验证请求。 */
async function handleLogin(): Promise<void> {
  errorMessage.value = "";

  if (!username.value || !password.value) {
    errorMessage.value = "请输入用户名和密码。";
    return;
  }

  submitting.value = true;

  try {
    const result = await props.client.request("auth.login", {
      username: username.value,
      password: password.value,
    });

    if (
      typeof result !== "object" ||
      result === null ||
      !("id" in result) ||
      typeof result.id !== "string" ||
      !("username" in result) ||
      typeof result.username !== "string" ||
      !("isVip" in result) ||
      typeof result.isVip !== "boolean"
    ) {
      throw new Error("Invalid login response");
    }

    password.value = "";

    emit("authenticated", {
      id: result.id,
      username: result.username,
      isVip: result.isVip,
    });
    
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    switch (message) {
      case "Invalid username or password":
        errorMessage.value = "用户名或密码错误。";
        break;

      case "WebSocket is not connected":
      case "Connection closed":
      case "Client closed":
        errorMessage.value = "服务器连接已断开，请刷新页面后重试。";
        break;

      case "Request timed out: auth.login":
        errorMessage.value = "登录请求超时，请稍后重试。";
        break;

      case "Too many login attempts. Please try again later.":
        errorMessage.value = "登录尝试过于频繁，请在 15 分钟后重试。";
        break;

      default:
        errorMessage.value = "登录失败，请稍后重试。";
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <section class="auth-form-section">
    <div class="auth-form-header">
      <h2>欢迎回来</h2>
      <p>输入账号信息，继续使用 SecureTransfer。</p>
    </div>

    <form class="auth-form" @submit.prevent="handleLogin">
      <div class="field">
        <label for="login-username">用户名</label>
        <input
          id="login-username"
          v-model.trim="username"
          type="text"
          autocomplete="username"
          placeholder="请输入用户名"
          maxlength="32"
          required
          :disabled="disabled || submitting"
        />
      </div>

      <div class="field">
        <label for="login-password">密码</label>

        <div class="password-field">
          <input
            id="login-password"
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="current-password"
            placeholder="请输入密码"
            required
            :disabled="disabled || submitting"
          />

          <button
            type="button"
            class="visibility-button"
            :disabled="disabled || submitting"
            @click="showPassword = !showPassword"
          >
            {{ showPassword ? "隐藏" : "显示" }}
          </button>
        </div>
      </div>

      <p v-if="errorMessage" class="feedback error" role="alert">
        {{ errorMessage }}
      </p>

      <button
        class="submit-button"
        type="submit"
        :disabled="disabled || submitting"
      >
        {{ submitting ? "正在验证…" : "登录" }}
      </button>
    </form>
  </section>
</template>