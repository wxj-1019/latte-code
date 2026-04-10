import type { Command } from '../../commands.js'

const stats = {
  type: 'local-jsx',
  name: 'stats',
  description: 'Show your Claude Code usage statistics and activity',
  descriptionZh: '显示使用统计',
  descriptionZh: '显示统计信息',
  load: () => import('./stats.js'),
} satisfies Command

export default stats
