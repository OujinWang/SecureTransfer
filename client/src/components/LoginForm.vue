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

const errorMessage = ref("");
const successMessage = ref("");

/** 校验登录表单并提交身份验证请求。 */
async function handleLogin(): Promise<void> {
  errorMessage.value = "";
  successMessage.value = "";

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
      typeof result.username !== "string"
    ) {
      throw new Error("Invalid login response");
    }

    successMessage.value = `欢迎回来，${result.username}！身份验证成功。`;
    password.value = "";
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

      default:
        errorMessage.value = "登录失败，请稍后重试。";
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <section class="login-card">
    <div class="card-header">
      <h2>欢迎回来</h2>
      <p>输入账号信息，继续使用 SecureTransfer。</p>
    </div>

    <form class="login-form" @submit.prevent="handleLogin">
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

      <p v-if="successMessage" class="feedback success" role="status">
        {{ successMessage }}
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

<style scoped>
.login-card {
  box-sizing: border-box;
  width: 100%;
  padding: 32px;
  background: #ffffff;
  border: 1px solid #e7eaf0;
  border-radius: 18px;
  box-shadow: 0 12px 40px rgba(25, 40, 70, 0.06);
}

.card-header {
  margin-bottom: 28px;
}

.card-header h2 {
  margin: 0 0 8px;
  color: #18243a;
  font-size: 23px;
  font-weight: 650;
}

.card-header p {
  margin: 0;
  color: #788397;
  font-size: 14px;
  line-height: 1.6;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field label {
  color: #344158;
  font-size: 13px;
  font-weight: 600;
}

.field input {
  box-sizing: border-box;
  width: 100%;
  height: 44px;
  padding: 0 13px;
  color: #18243a;
  background: #ffffff;
  border: 1px solid #dce2eb;
  border-radius: 9px;
  font: inherit;
  font-size: 14px;
  outline: none;
}

.field input:focus {
  border-color: #6887d5;
  box-shadow: 0 0 0 3px rgba(104, 135, 213, 0.12);
}

.field input:disabled {
  background: #f6f7f9;
  cursor: not-allowed;
}

.field input::placeholder {
  color: #a5adba;
}

.password-field {
  position: relative;
}

.password-field input {
  padding-right: 65px;
}

.visibility-button {
  position: absolute;
  top: 50%;
  right: 12px;
  transform: translateY(-50%);
  padding: 4px;
  color: #647da9;
  background: transparent;
  border: 0;
  cursor: pointer;
  font-size: 12px;
}

.submit-button {
  height: 46px;
  margin-top: 4px;
  color: #ffffff;
  background: #4267b2;
  border: 0;
  border-radius: 9px;
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
}

.submit-button:hover:not(:disabled) {
  background: #34569a;
}

.submit-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.feedback {
  margin: 0;
  padding: 11px 13px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.6;
}

.error {
  color: #a33340;
  background: #fff0f1;
}

.success {
  color: #23734d;
  background: #edf8f1;
}

@media (max-width: 480px) {
  .login-card {
    padding: 24px;
  }
}
</style>