import type { Command } from '../../commands.js'

export default {
  type: 'local-jsx',
  name: 'diff',
  description: 'View uncommitted changes and per-turn diffs',
  descriptionZh: '查看未提交的更改',
  descriptionZh: '显示工作区的更改',
  load: () => import('./diff.js'),
} satisfies Command
