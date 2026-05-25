import type { Command } from '../../commands.js'

const goal: Command = {
  type: 'local',
  name: 'goal',
  description: 'Set and manage persistent objectives for autonomous task execution',
  descriptionZh: '设置和管理持久化目标',
  argumentHint: '[<objective>|pause|resume|clear]',
  load: () => import('./goal.js'),
}

export default goal
