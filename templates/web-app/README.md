# Web App 模板(PWA)

Vite + TypeScript,无框架。手机浏览器可"添加到主屏幕"。数据默认存在浏览器本地。

## 命令
本期只在本机预览,模板不含任何托管平台配置。端口可用环境变量改,如 `PORT=5000 npm run dev`。

```
npm install
npm run build      # 类型检查 + 构建到 dist/
npm run preview    # 本地预览构建结果,默认 http://localhost:4173
npm run dev        # 开发服务,默认 5173
npm test           # Playwright 冒烟测试(手机尺寸,会先构建);首次需 npx playwright install chromium
```

## Agent 该改哪里
| 要做的事 | 改这里 |
|---|---|
| 页面内容与逻辑 | `src/pages/*.ts`(示例:`home.ts`,整体替换) |
| 新增页面 | 新建 `src/pages/xxx.ts`,在 `src/main.ts` 的 `routes` 登记 |
| 样式、主题色 | `src/style.css`(变量在 `:root`) |
| 应用名、主题色(安装时用) | `public/manifest.webmanifest`、`index.html` 的 `<title>` 和 `theme-color` |
| 图标 | 替换 `public/icon.svg`、`icon-192.png`、`icon-512.png` |
| 冒烟测试 | `tests/smoke.spec.ts`:改成客户验收标准里的主要流程 |

## 不该动
- `public/sw.js` 的缓存逻辑——只在发布新版后把 `VERSION` 加 1,让手机更新缓存。
- `playwright.config.ts` 的手机视口和 `webServer`:自测必须针对构建结果、手机尺寸。
- `vite.config.ts`、`tsconfig.json`,除非构建因此无法通过。
- 不要提交 `node_modules/`、`dist/`、`test-results/`。

## 约定
- 手机优先:点击区域 ≥ 44px,输入框字号 ≥ 16px(防 iOS 缩放)。
- 没有后端。需要多人共享数据时,先在需求里讲清楚,再决定,不要自行加服务。
