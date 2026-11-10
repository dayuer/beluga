---
name: client-deploy
description: 客户确认版本、说"上线/发布/交付"时使用:生成一个客户能在自己服务器上部署的交付包(静态文件 + Docker + Nginx 示例 + 中文部署说明)。不替客户上线、不碰客户服务器的任何凭据。
---

# 生成可自行部署的交付包

已决定:**部署到客户自己的服务器**。我们不登录客户的服务器,不收他们的密码或密钥,只交付一个包,附中文说明,客户或他的运维照着做。

```bash
skills/client-deploy/pack.sh [--ref <tag>] [项目目录] [输出目录]
```

- 默认输出到 `<项目>/delivery/<项目名>-<版本>/` 和同名 `.tar.gz`(`delivery/` 要在项目 `.gitignore` 里)。
- `--ref <tag>` 用某个旧版本打包(回退/重发某一版)。版本号取该 tag,没有 tag 则用提交短哈希。
- 最后两行 `PACK_DIR=`、`PACK_TGZ=` 是产物位置。

## 包里有什么
`site/`(构建产物,任何 Nginx 都能托管)、`Dockerfile` + `docker-compose.yml`、`docker-compose.https.yml` + `Caddyfile`(自动 HTTPS)、`nginx/`(容器内配置 + 已有 Nginx 的示例)、`.env.example`(只有 `HOST_PORT`、`DOMAIN`,均可选)、`部署说明.md`(面向非专业运维)。

文字在 `templates/` 里,改说明就改那里。有后端的项目:只给 Docker 方式,`Dockerfile` 要换成项目自己的(以 `templates/Dockerfile` 为起点)。

## 流程
1. 前提:客户已确认当前版本并有 tag(见 client-build-loop)。没确认不打包。
2. 运行 `pack.sh`。构建失败:读输出里的报错改代码,`npm run build && npm test` 绿后重试(最多 3 轮,再不行用选择题白话告诉客户)。
3. **验证(必须)**:把 tar.gz 解到一个全新的空目录,严格按 `部署说明.md` 的方式一执行 `docker compose up -d --build`(`HOST_PORT` 选个空闲端口),用手机尺寸截图确认能打开,再 `docker compose down`。验证不通过不交付。
4. 把 tar.gz 用 `send_file` 发回客户,配 3 行白话:这是什么、交给谁(运维或自己)、从 `部署说明.md` 开始看;附验证截图。

## 凭据规则(硬性)
- 包里**不含任何密钥**;`pack.sh` 会在发现 `.env`/`.pem`/`.key`/`id_*` 或私钥内容时中止。
- 不向客户索要服务器密码、SSH 私钥、云账号;客户的运维要什么自己配,配在他们的服务器上。
- 需要的环境变量只在 `部署说明.md` 里列名字和用途,不填真实值。

## 自检清单
- [ ] 客户已确认版本且有 tag
- [ ] 在全新目录按说明部署成功,有手机尺寸截图
- [ ] 包里没有密钥,变量只列了名字
- [ ] 已把 tar.gz 和截图发回客户
