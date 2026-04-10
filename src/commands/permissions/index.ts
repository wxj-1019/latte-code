import type { Command } from '../../commands.js'

const permissions = {
  type: 'local-jsx',
  name: 'permissions',
  aliases: ['allowed-tools'],
  description: 'Manage allow & deny tool permission rules',
  descriptionZh: '管理权限规则',
  descriptionZh: '管理权限设置',
  load: () => import('./permissions.js'),
} satisfies Command

export default permissions
