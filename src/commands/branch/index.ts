import { feature } from 'bun:bundle'
import type { Command } from '../../commands.js'

const branch = {
  type: 'local-jsx',
  name: 'branch',
  // 'fork' alias only when /fork doesn't exist as its own command
  aliases: feature('FORK_SUBAGENT') ? [] : ['fork'],
  description: 'Create a branch of the current conversation at this point',
  descriptionZh: '创建会话分支',
  descriptionZh: '显示或切换 Git 分支',
  argumentHint: '[name]',
  load: () => import('./branch.js'),
} satisfies Command

export default branch
