import type { Command } from '../../commands.js'

const mobile = {
  type: 'local-jsx',
  name: 'mobile',
  aliases: ['ios', 'android'],
  description: 'Show QR code to download the Claude mobile app',
  descriptionZh: '显示移动应用二维码',
  descriptionZh: '移动设备集成',
  load: () => import('./mobile.js'),
} satisfies Command

export default mobile
