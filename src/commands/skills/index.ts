import type { Command } from '../../commands.js'

const skills = {
  type: 'local-jsx',
  name: 'skills',
  description: 'List available skills',
  descriptionZh: '列出可用技能',
  descriptionZh: '管理技能',
  load: () => import('./skills.js'),
} satisfies Command

export default skills
