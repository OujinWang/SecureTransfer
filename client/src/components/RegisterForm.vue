<script setup lang="ts">
import { ref } from "vue";
import type { SecureTransferClient } from "../ws/client";

const props = defineProps<{
  client: SecureTransferClient;
  disabled: boolean;
}>();

const username = ref("");
const password = ref("");
const confirmPassword = ref("");
const showPassword = ref(false);

const submitting = ref(false);
const errorMessage = ref("");
const successMessage = ref("");

/** 校验注册表单并提交请求。 */
async function handleRegister(): Promise<void> {
  errorMessage.value = "";
  successMessage.value = "";

  if (!/^[a-zA-Z0-9_]{3,32}$/.test(username.value)) {
    errorMessage.value = "用户名需要 3–32 位，只能包含字母、数字和下划线。";
    return;
  }

  const passwordLength = [...password.value].length;

  if (passwordLength < 8 || passwordLength > 20) {
    errorMessage.value = "密码长度需为 8–20 个字符。";
    return;
  }

  if (password.value !== confirmPassword.value) {
    errorMessage.value = "两次输入的密码不一致。";
    return;
  }

  submitting.value = true;

  try {
    const result = await props.client.request("auth.register", {
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
      throw new Error("Invalid registration response");
    }

    successMessage.value = `账号 ${result.username} 注册成功。`;
    password.value = "";
    confirmPassword.value = "";
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    switch (message) {
      case "Username already exists":
        errorMessage.value = "这个用户名已经被使用了。";
        break;
      case "WebSocket is not connected":
      case "Connection closed":
      case "Client closed":
        errorMessage.value = "服务器连接已断开，请刷新页面后重试。";
        break;
      default:
        errorMessage.value = "注册失败，请稍后重试。";
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <section class="auth-form-section">
    <div class="auth-form-header">
      <div>
        <h2>创建账号</h2>
        <p>注册后即可使用安全文件传输服务。</p>
      </div>
    </div>

    <form class="auth-form" @submit.prevent="handleRegister">
      <div class="field">
        <label for="register-username">用户名</label>
        <input
          id="register-username"
          v-model.trim="username"
          type="text"
          autocomplete="username"
          placeholder="3–32 位字母、数字或下划线"
          maxlength="32"
          required
          :disabled="disabled || submitting"
        />
      </div>

      <div class="field">
        <label for="register-password">密码</label>
        <div class="password-field">
          <input
            id="register-password"
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="new-password"
            placeholder="8–20 个字符"
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

      <div class="field">
        <label for="register-confirm">确认密码</label>
        <input
          id="register-confirm"
          v-model="confirmPassword"
          :type="showPassword ? 'text' : 'password'"
          autocomplete="new-password"
          placeholder="再次输入密码"
          required
          :disabled="disabled || submitting"
        />
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
        {{ submitting ? "正在注册…" : "创建账号" }}
      </button>
    </form>
  </section>
</template>