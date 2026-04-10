import type { Command } from '../../commands.js'

const ide = {
  type: 'local-jsx',
  name: 'ide',
  description: 'Manage IDE integrations and show status',
  descriptionZh: '管理 IDE 集成',
  descriptionZh: '配置 IDE 集成',
  argumentHint: '[open]',
  load: () => import('./ide.js'),
} satisfies Command

export default ide
