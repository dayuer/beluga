import type { Translation } from '../../../../../src/shared/i18n.js';
import type { autoRoute as en } from '../en/auto-route.js';

export const autoRoute: Translation<typeof en> = {
  'tasks.start.auto': '自动 · {model}',
  'autoRoute.title': '自动路由',
  'autoRoute.on': '自动为任务选模型',
  'autoRoute.onDetail': '没有指定 agent 的任务，启动时交给列表里第一个在本机可用的模型。任务、计划或项目自己指定的 agent 始终优先。',
  'autoRoute.urgent': '紧急和高优先级也算疑难',
  'autoRoute.urgentDetail': '带“{label}”标签的任务一定算疑难。先在项目标签里加上这个标签，任务才能用它。',
  'autoRoute.hardTitle': '疑难任务',
  'autoRoute.buildTitle': '其他任务',
  'autoRoute.nth': '第 {n} 选',
  'autoRoute.used': '当前使用',
  'autoRoute.standby': '上面的不可用时使用',
  'autoRoute.skipped': '本机没有配置，跳过',
  'autoRoute.up': '上移',
  'autoRoute.remove': '移除',
  'autoRoute.add': '添加',
  'autoRoute.reset': '恢复默认',
  'autoRoute.nowUses': '这类任务从标着“当前使用”的模型开始',
  'autoRoute.noneRuns': '列表里没有本机可用的模型：这类任务交给你的默认 agent',
  'autoRoute.customDetail': '你自定义的列表。',
  'autoRoute.defaultDetail': '默认列表。',
  'autoRoute.findDetail': '没有指定 agent 的任务交给哪个模型',
};
