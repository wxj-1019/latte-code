import type { Command } from '../../commands.js'

const hooks = {
  type: 'local-jsx',
  name: 'hooks',
  description: 'View hook configurations for tool events',
  descriptionZh: '查看钩子配置',
  descriptionZh: '管理钩子',
  immediate: true,
  load: () => import('./hooks.js'),
} satisfies Command

export default hooks
