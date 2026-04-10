import type { Command } from '../../commands.js'

const config = {
  aliases: ['settings'],
  type: 'local-jsx',
  name: 'config',
  description: 'Open config panel',
  descriptionZh: '打开配置面板',
  descriptionZh: '打开配置面板',
  load: () => import('./config.js'),
} satisfies Command

export default config
