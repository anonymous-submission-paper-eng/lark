import { defineConfig } from "vite";

const apiTarget = process.env.VITE_LARK_API_TARGET || "http://127.0.0.1:8088";
const uploadTarget = process.env.VITE_LARK_UPLOAD_TARGET || "http://127.0.0.1:7800";
const minioTarget = process.env.VITE_LARK_MINIO_TARGET || "http://127.0.0.1:9000";
const wsTarget = process.env.VITE_LARK_WS_TARGET || "ws://127.0.0.1:7301";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api/upload": {
        target: uploadTarget,
        changeOrigin: true,
        secure: false
      },
      "/photos": {
        target: minioTarget,
        changeOrigin: true,
        secure: false
      },
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
