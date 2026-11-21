
<script setup lang="ts">
import { ref } from "vue";
import type { SecureTransferClient } from "../ws/client";

import "../styles/auth.css";

import LoginForm from "./LoginForm.vue";
import RegisterForm from "./RegisterForm.vue";

defineProps<{
  client: SecureTransferClient;
  disabled: boolean;
}>();

const emit = defineEmits<{
  authenticated: [user: { id: string; username: string; isVip: boolean}];
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
        @authenticated="(user) => emit('authenticated', user)"
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
