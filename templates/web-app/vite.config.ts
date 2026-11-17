import { defineConfig } from 'vite';

// 端口可用环境变量 PORT 改:PORT=5000 npm run dev
const port = Number(process.env.PORT) || undefined;

export default defineConfig({
  build: { target: 'es2022' },
  server: { host: true, port: port ?? 5173 },
  preview: { host: true, port: port ?? 4173, strictPort: true },
});
