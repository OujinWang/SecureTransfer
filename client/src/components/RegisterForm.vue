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

  if (
    password.value.length < 12 ||
    new TextEncoder().encode(password.value).length > 128
  ) {
    errorMessage.value = "密码至少需要 12 个字符，且不能超过 128 字节。";
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
  <section class="register-card">
    <div class="card-header">
      <div>
        <h2>创建账号</h2>
        <p>注册后即可使用安全文件传输服务。</p>
      </div>
    </div>

    <form class="register-form" @submit.prevent="handleRegister">
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
            placeholder="至少 12 个字符"
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

<style scoped>
.register-card {
  width: 100%;
  max-width: 440px;
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

.register-form {
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
  transition: border-color 0.2s, box-shadow 0.2s;
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
  transition: background 0.2s;
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
  .register-card {
    box-sizing: border-box;
    padding: 24px;
  }
}
</style>