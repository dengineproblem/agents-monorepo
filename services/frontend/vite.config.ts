import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8081,
    historyApiFallback: true,
    proxy: {
      // Специфичный proxy для analyzer (порт 7081)
      // Убираем /api/analyzer префикс, т.к. analyzerService ожидает запросы без префикса
      '/api/analyzer': {
        target: 'http://localhost:7081',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/analyzer/, ''),
      },
      // Общий proxy для остальных API (порт 8082)
      '/api': {
        target: 'http://localhost:8082',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    mode === 'development' &&
    componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
