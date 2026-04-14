import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, ".."), "")
  const port = parseInt(env.PORT || env.FRONTEND_PORT || "3001")
  const backendPort = env.BACKEND_PORT || "8000"
  const allowedHosts = (env.ALLOWED_HOSTS || "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean)
  const apiBaseUrl = env.VITE_API_BASE_URL || env.API_BASE_URL || "/api"
  const shouldProxyApi = apiBaseUrl === "/api"

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      port,
      strictPort: true,
      host: "0.0.0.0",
      allowedHosts,
      proxy: shouldProxyApi
        ? {
            "/api": {
              target: `http://localhost:${backendPort}`,
              changeOrigin: true,
            },
          }
        : undefined,
    },
  }
})
