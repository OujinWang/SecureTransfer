
<script setup lang="ts">
import { ref } from "vue";
import type { SecureTransferClient } from "../ws/client";

import LoginForm from "./LoginForm.vue";
import RegisterForm from "./RegisterForm.vue";

defineProps<{
  client: SecureTransferClient;
  disabled: boolean;
}>();

type AuthMode = "login" | "register";

const mode = ref<AuthMode>("login");
</script>

<template>
  <div class="auth-card">
    <div class="auth-tabs" role="group" aria-label="账号操作">
      <button
        type="button"
        :class="{ active: mode === 'login' }"
        :aria-pressed="mode === 'login'"
        @click="mode = 'login'"
      >
        登录
      </button>

      <button
        type="button"
        :class="{ active: mode === 'register' }"
        :aria-pressed="mode === 'register'"
        @click="mode = 'register'"
      >
        注册
      </button>
    </div>

    <div class="auth-content">
      <LoginForm
        v-if="mode === 'login'"
        :client="client"
        :disabled="disabled"
      />

      <RegisterForm
        v-else
        :client="client"
        :disabled="disabled"
      />
    </div>
  </div>
</template>

<style scoped>
.auth-card {
  width: 100%;
  max-width: 420px;
  padding: 30px;
  background: #ffffff;
  border: 1px solid #e9e9ec;
  border-radius: 20px;
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.015),
    0 16px 48px rgba(0, 0, 0, 0.035);
}

.auth-tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  margin-bottom: 32px;
  background: #f5f5f7;
  border-radius: 11px;
}

.auth-tabs button {
  flex: 1;
  height: 39px;
  padding: 0;
  color: #86868b;
  background: transparent;
  border: 0;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  transition:
    color 0.18s ease,
    background 0.18s ease,
    box-shadow 0.18s ease;
}

.auth-tabs button.active {
  color: #1d1d1f;
  background: #ffffff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}

.auth-tabs button:focus-visible {
  outline: 2px solid #86868b;
  outline-offset: 2px;
}

.auth-content {
  width: 100%;
}

/* 移除子组件原有的独立卡片外观 */
.auth-content :deep(section) {
  width: 100%;
  max-width: none;
  margin: 0;
  padding: 0;
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}

/* 统一表单标题 */
.auth-content :deep(h2),
.auth-content :deep(h3) {
  margin: 0 0 8px;
  color: #1d1d1f;
  font-size: 21px;
  font-weight: 600;
  letter-spacing: -0.4px;
}

.auth-content :deep(.card-header) {
  margin-bottom: 28px;
}

.auth-content :deep(.card-header p) {
  margin: 0;
  color: #6e6e73;
  font-size: 13px;
  line-height: 1.6;
}

/* 统一表单布局 */
.auth-content :deep(form) {
  display: flex;
  flex-direction: column;
  gap: 19px;
  width: 100%;
}

.auth-content :deep(.field) {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.auth-content :deep(label) {
  display: block;
  color: #3a3a3c;
  font-size: 13px;
  font-weight: 600;
}

/* 统一输入框 */
.auth-content :deep(input) {
  width: 100%;
  height: 45px;
  padding: 0 13px;
  color: #1d1d1f;
  background: #ffffff;
  border: 1px solid #dcdce0;
  border-radius: 10px;
  outline: none;
  font-size: 14px;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.auth-content :deep(input::placeholder) {
  color: #aeaeb2;
}

.auth-content :deep(input:focus) {
  border-color: #86868b;
  box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.055);
}

.auth-content :deep(input:disabled) {
  color: #aeaeb2;
  background: #f5f5f7;
  cursor: not-allowed;
}

/* 密码显示按钮 */
.auth-content :deep(.password-field) {
  position: relative;
  width: 100%;
}

.auth-content :deep(.password-field input) {
  padding-right: 65px;
}

.auth-content :deep(section button:not([type="submit"])) {
  color: #86868b;
}

/* 统一主操作按钮 */
.auth-content :deep(button[type="submit"]) {
  width: 100%;
  min-height: 45px;
  margin-top: 5px;
  padding: 10px 16px;
  color: #ffffff;
  background: #1d1d1f;
  border: 1px solid #1d1d1f;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  transition:
    background 0.18s ease,
    transform 0.18s ease;
}

.auth-content :deep(button[type="submit"]:hover:not(:disabled)) {
  background: #38383b;
  border-color: #38383b;
}

.auth-content :deep(button[type="submit"]:active:not(:disabled)) {
  transform: scale(0.99);
}

.auth-content :deep(button[type="submit"]:disabled) {
  opacity: 0.45;
  cursor: not-allowed;
}

/* 反馈信息 */
.auth-content :deep(.feedback) {
  margin: 0;
  padding: 11px 13px;
  border-radius: 9px;
  font-size: 13px;
  line-height: 1.6;
}

.auth-content :deep(.feedback.error) {
  color: #9f3434;
  background: #fbefef;
}

.auth-content :deep(.feedback.success) {
  color: #3a3a3c;
  background: #f1f1f3;
}

@media (max-width: 480px) {
  .auth-card {
    padding: 24px 20px;
    border-radius: 16px;
  }

  .auth-tabs {
    margin-bottom: 28px;
  }
}
</style>
