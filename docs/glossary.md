# Glossary

The words the screens use, on the Mac, the phone and the web. One thing gets one word; the
code may use other names, the window never does. Chinese is what `packages/mac/src/i18n/zh-CN.json`
already says: change a word here and there together ([i18n.md](i18n.md)).

How the screens look and read: [design.md](design.md).

## Where work happens

| Word | 中文 | What it is | Not |
|---|---|---|---|
| **Project** | 项目 | A repository you added. Its sidebar row opens its home. | repo, folder |
| **Project home** | — | A project's main checkout. You ask here; changes happen in a worktree ("Continue in New Worktree"). Never a conversation of its own. | main checkout, root |
| **Worktree** | 工作树 | A checkout of its own on its own branch, where an agent makes changes. Every worktree is a task. | sandbox, clone |
| **Workspace** | 工作区 | Any place you work in, a worktree or a shared one: what Archive, Fork, Invite and Next Workspace act on (open, below). | — |
| **Your Mac** | 你的 Mac | Chats with no project: your own assistant on this computer. | global, home |
| **Computer** | 电脑 | A Mac or server running Beluga that a chat can run on (Runs on). | host, machine, node |

## Talking to agents

| Word | 中文 | What it is | Not |
|---|---|---|---|
| **Agent** | 智能体 | Claude, Codex, OpenCode, Copilot or Antigravity doing the work. | bot, AI, model (a model is what an agent runs on) |
| **Sub-agent** | 子智能体 | An agent the main agent started for part of its work; nested under its chat. | child, worker |
| **Chat** / **Conversation** | 聊天 / 对话 | One thread with an agent or people. Both words are in use today (open, below). | session, thread |
| **Steer** | 引导 | Send a message into the turn that's running; the agent reads it after its current step. | interrupt |
| **Queue** | 排队 | Hold a message until the turn ends. | — |
| **Act** / **Plan First** | 执行 / 先做计划 | The composer's modes: work now, or propose a plan to approve first. | — |
| **Autopilot** | 自动驾驶 | Approves what you'd allow anyway, so a run doesn't stop for you. | yolo, auto-approve |

## Work to track

| Word | 中文 | What it is | Not |
|---|---|---|---|
| **Task** | 任务 | One piece of work on the board, with a brief and (once started) a worktree and a PR. | ticket, issue (an **Issue** is GitHub's) |
| **Epic** | 史诗 | A task with sub-tasks. | parent |
| **Plan** | 计划 | Milestones of tasks with gates, run step by step, with check-ins or on autopilot ([tasks-and-plans.md](tasks-and-plans.md)). | roadmap, project |
| **Milestone** | 里程碑 | One stage of a plan, ending in a recap. | phase |
| **Sentinel** / **a sentinel** | 哨兵 | The section, and one watcher in it: when something is due or happens, it does its steps and leaves a report ([sentinel.md](sentinel.md)). | rule, automation, job |

## What waits for you

| Word | 中文 | What it is | Not |
|---|---|---|---|
| **Needs you** | 需要你 | Anything that stops until you answer: an approval, a question, a plan, a friend's request, a decision. | pending, blocked, inbox item |
| **Approve** / **Decline** / **Always** | 批准 / 拒绝 / 始终 | The answers to an approval. | accept, deny, allow all |

## People

| Word | 中文 | What it is | Not |
|---|---|---|---|
| **Friend** | 好友 | Someone you trust, on the network: DMs, shared projects, tasks for each other. | contact, peer |
| **Group** | 群组 | Friends in one conversation. | channel (in the window) |
| **Room** | 房间 | Whoever joined your invite link, through your Mac. Being folded into friends (open, below). | session, lobby |

## Open

Words with two answers today. Each is settled where the screens change, not here:

- **Chat or Conversation.** The catalog has about as many of each. The sidebar and the composer say
  Chat (New Chat); the docs and the phone often say conversation.
- **Worktree or Workspace.** Creating one says worktree (New Worktree); acting on one, in its menus
  and shortcuts, says workspace. Say worktree for one of your own checkouts, workspace only where
  the thing can also be someone else's shared one.
- **Room and Friends.** Two people systems ([agent-to-agent.md](agent-to-agent.md): rooms fold into
  the network; an old room link opens as a friend request). Until they're one, keep the words apart:
  "in this room" for a room, friends and groups for the network.
