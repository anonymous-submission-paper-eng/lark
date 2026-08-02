import { defineConfig } from "vite";

const apiTarget = process.env.VITE_LARK_API_TARGET || "http://127.0.0.1:8088";
const wsTarget = process.env.VITE_LARK_WS_TARGET || "ws://127.0.0.1:7301";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/open": {
        target: apiTarget,
        changeOrigin: true,
        secure: false
      },
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        secure: false
      },
      "/socket": {
        target: wsTarget,
        ws: true,
        changeOrigin: true,
        rewrite: () => "/"
      }
    }
  }
});
