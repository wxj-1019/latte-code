import type { Command } from '../../commands.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'

export default {
  type: 'local-jsx',
  name: 'add-model',
  description: 'Add a custom OpenAI-compatible model',
  argumentHint: '[name]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./add-model.js'),
} satisfies Command
