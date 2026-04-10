import type { Command } from '../../commands.js'

export default {
  type: 'local-jsx',
  name: 'usage',
  description: 'Show plan usage limits',
  descriptionZh: '显示使用限制',
  descriptionZh: '显示使用情况统计',
  availability: ['claude-ai'],
  load: () => import('./usage.js'),
} satisfies Command
