import type { Command } from '../../commands.js'

const theme = {
  type: 'local-jsx',
  name: 'theme',
  description: 'Change the theme',
  descriptionZh: '更改主题',
  descriptionZh: '更改主题',
  load: () => import('./theme.js'),
} satisfies Command

export default theme
