import { defineConfig } from '@playwright/test';

// 手机尺寸 + 构建后的预览服务,和客户在手机上看到的一致。端口用 PORT 改。
const port = Number(process.env.PORT) || 4173;
const url = `http://localhost:${port}`;

export default defineConfig({
  testDir: 'tests',
  use: { baseURL: url, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  webServer: { command: 'npm run build && npm run preview', url, reuseExistingServer: true, timeout: 120_000 },
});
