import type { Command } from '../../commands.js'

const status = {
  type: 'local-jsx',
  name: 'status',
  description:
    'Show Claude Code status including version, model, account, API connectivity, and tool statuses',
  descriptionZh: '显示当前状态',
  immediate: true,
  load: () => import('./status.js'),
} satisfies Command

export default status
