import type { Command } from '../../commands.js'

const exit = {
  type: 'local-jsx',
  name: 'exit',
  aliases: ['quit'],
  description: 'Exit the REPL',
  descriptionZh: '退出程序',
  descriptionZh: '退出程序',
  immediate: true,
  load: () => import('./exit.js'),
} satisfies Command

export default exit
