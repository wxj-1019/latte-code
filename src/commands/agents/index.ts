import type { Command } from '../../commands.js'

const agents = {
  type: 'local-jsx',
  name: 'agents',
  description: 'Manage agent configurations',
  descriptionZh: '管理 AI 助手配置',
  descriptionZh: '管理 AI 助手',
  load: () => import('./agents.js'),
} satisfies Command

export default agents
