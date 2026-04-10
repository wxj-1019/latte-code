import type { Command } from '../../commands.js'

const outputStyle = {
  type: 'local-jsx',
  name: 'output-style',
  description: 'Deprecated: use /config to change output style',
  descriptionZh: '更改输出样式（已弃用）',
  descriptionZh: '更改输出样式',
  isHidden: true,
  load: () => import('./output-style.js'),
} satisfies Command

export default outputStyle
