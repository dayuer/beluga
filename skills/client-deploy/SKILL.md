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

# 版本检查点与回退

`skills/client-deploy/versions.sh`(`PROJECT=<项目目录>`,默认当前目录)。每个版本 = git tag + 部署包 + 手机截图,存在 `delivery/versions/<tag>/`(不进 git)。

| 时机 | 命令 |
|---|---|
| 客户说"可以"(确认版本)后 | `versions.sh checkpoint round-N test-results/*.png`:建 tag(已有则复用)、打包、存截图 |
| 客户问"有哪些版本/我之前的版本" | `versions.sh list`,用白话把每版的日期、说明发回,并用 `send_file` 把该版 `screenshots/` 里的图一起发(手机上就是"版本列表 + 截图") |
| 客户说"回到上一版/回到第 N 版" | 先确认是哪一版(选择题,附该版截图),再 `versions.sh rollback <tag>`:拿到该版部署包 + `回退说明.md`,用 `send_file` 发给客户,告诉他交给运维按说明重新部署 |
| 同时也要让源码回到那一版 | 加 `--git`:恢复文件并新增一个"回退到 <tag>"提交,历史不改,之后新改动继续往下打 tag |

规则:回退前确认客户选的版本;不删 tag、不改历史;客户有数据库时提醒先备份。

# 交付移交(项目结束)

`skills/client-deploy/handover.sh [项目目录]` → 一个 `<项目>-交付-<日期>.tar.gz`:`部署包/`(最新 tag 的包 + 部署说明)、`源码/<项目>.bundle`(完整 git 库含全部 tag,`git clone` 即可恢复)、`历史版本.md`、`交付说明.md`(白话:拿到什么、怎么上线、怎么改、怎么回退、账号归谁)。用 `send_file` 发给客户。

- 域名、服务器、云账号本来就是客户的,我们从不持有;说明里如实写明,不转移也不索要凭据。
- 代码在 GitHub 上时:**转移仓库是对外且难撤回的动作,先用选择题问客户"现在把代码库转到你的 GitHub 账号吗?(是/稍后,打包就够)"和对方账号名**,同意才加 `--transfer-github <账号>`;对方要在邮箱里点接受。不同意就只交 bundle。
- 要求所有改动已提交且至少有一个 tag,否则脚本拒绝。
