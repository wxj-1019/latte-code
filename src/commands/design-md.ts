import { Command } from '../types/command';
import { designMdSkill } from '../skills/design-md-skill';

export const designMdCommand: Command = {
  name: 'design-md',
  description: 'Access the awesome-design-md collection of 66+ brand design systems',
  usage: '/design-md <action> [brand] [options]',
  examples: [
    '/design-md get apple',
    '/design-md get stripe --format json',
    '/design-md search fintech',
    '/design-md list',
    '/design-md preview tesla --theme dark',
    '/design-md compare stripe,apple,claude'
  ],
  parameters: {
    action: {
      type: 'string',
      required: true,
      description: 'Action to perform: get, search, list, preview, compare'
    },
    brand: {
      type: 'string',
      required: false,
      description: 'Brand name (e.g., apple, stripe, claude)'
    },
    query: {
      type: 'string',
      required: false,
      description: 'Search query or comma-separated brands for comparison'
    },
    format: {
      type: 'string',
      required: false,
      default: 'markdown',
      description: 'Output format: markdown, json, html'
    },
    theme: {
      type: 'string',
      required: false,
      default: 'light',
      description: 'Theme for preview: light, dark'
    }
  },
  aliases: ['dm', 'design', 'ds'],
  category: 'Design',
  handler: async (args: string[], flags: Record<string, any>) => {
    const [action, brand] = args;
    const { format, theme, query } = flags;

    if (!action) {
      return {
        success: false,
        error: 'Action is required. Use: get, search, list, preview, or compare'
      };
    }

    try {
      const result = await designMdSkill.handler({
        action: action as any,
        brand,
        query: query || brand,
        format: format || 'markdown',
        theme: theme || 'light'
      });

      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message,
        suggestion: 'Try /design-md list to see available brands'
      };
    }
  }
};