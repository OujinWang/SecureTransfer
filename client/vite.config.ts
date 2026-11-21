
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig(({ command }) => ({
  plugins: [vue()],

  // 仅开发服务器需要 HTTPS 证书和代理。
  // 生产构建不读取证书，避免 Docker 构建依赖本地私钥。
  server: command === "serve"
    ? {
        https: {
          key: readFileSync(
            new URL("../certs/localhost-key.pem", import.meta.url),
          ),
          cert: readFileSync(
            new URL("../certs/localhost.pem", import.meta.url),
          ),
        },

        proxy: {
          "/api": {
            target: "https://127.0.0.1:3000",
            changeOrigin: true,
            secure: false,
          },

          "/ws": {
            target: "wss://127.0.0.1:3000",
            ws: true,
            changeOrigin: true,
            secure: false,
          },
        },
      }
    : undefined,
}));
