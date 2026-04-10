import type { Command } from '../../commands.js'

const memory: Command = {
  type: 'local-jsx',
  name: 'memory',
  description: 'Edit Claude memory files',
  descriptionZh: '编辑记忆文件',
  descriptionZh: '管理长期记忆',
  load: () => import('./memory.js'),
}

export default memory
