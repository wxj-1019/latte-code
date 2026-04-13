import { z } from 'zod';
import type { Skill } from '../types/skill';
import { fetchDesignSystem, searchDesignSystems, listAllDesignSystems } from './design-md-utils';

export const designMdSkill: Skill = {
  name: 'design-md',
  description: 'Access and utilize the awesome-design-md design system collection',
  parameters: z.object({
    action: z.enum(['get', 'search', 'list', 'preview', 'compare']),
    brand: z.string().optional(),
    query: z.string().optional(),
    format: z.enum(['markdown', 'json', 'html']).default('markdown'),
    theme: z.enum(['light', 'dark']).default('light')
  }),
  examples: [
    '/design-md get apple',
    '/design-md search fintech',
    '/design-md list',
    '/design-md get stripe --format json',
    '/design-md preview tesla --theme dark'
  ],
  handler: async (args) => {
    const { action, brand, query, format, theme } = args;

    try {
      switch (action) {
        case 'get':
          if (!brand) throw new Error('Brand parameter required for get action');
          return await fetchDesignSystem(brand, format, theme);

        case 'search':
          if (!query) throw new Error('Query parameter required for search action');
          return await searchDesignSystems(query);

        case 'list':
          return await listAllDesignSystems();

        case 'preview':
          if (!brand) throw new Error('Brand parameter required for preview action');
          return await generatePreview(brand, theme);

        case 'compare':
          if (!query) throw new Error('Query parameter required for compare action');
          return await compareDesignSystems(query.split(','));

        default:
          throw new Error(`Unknown action: ${action}`);
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
        suggestion: 'Use /design-md list to see available brands'
      };
    }
  }
};

async function generatePreview(brand: string, theme: 'light' | 'dark') {
  const designSystem = await fetchDesignSystem(brand, 'json', theme);

  return {
    success: true,
    brand,
    theme,
    previewUrl: `https://getdesign.md/${brand.toLowerCase()}/preview${theme === 'dark' ? '-dark' : ''}.html`,
    designSystem: designSystem.data
  };
}

async function compareDesignSystems(brands: string[]) {
  const comparisons = await Promise.all(
    brands.map(async (brand) => {
      const data = await fetchDesignSystem(brand.trim(), 'json', 'light');
      return {
        brand: brand.trim(),
        colors: data.data.colors,
        typography: data.data.typography,
        components: data.data.components?.slice(0, 5) // Top 5 components
      };
    })
  );

  return {
    success: true,
    comparison: comparisons,
    summary: generateComparisonSummary(comparisons)
  };
}

function generateComparisonSummary(comparisons: any[]) {
  const colorAnalysis = analyzeColorSimilarity(comparisons);
  const typographyAnalysis = analyzeTypography(comparisons);

  return {
    totalBrands: comparisons.length,
    colorThemes: colorAnalysis,
    fontFamilies: typographyAnalysis,
    recommendations: generateRecommendations(comparisons)
  };
}

function analyzeColorSimilarity(comparisons: any[]) {
  // Implementation for color analysis
  return comparisons.map(c => ({
    brand: c.brand,
    primaryColor: c.colors?.primary || 'N/A',
    theme: detectThemeType(c.colors)
  }));
}

function analyzeTypography(comparisons: any[]) {
  return comparisons.map(c => ({
    brand: c.brand,
    primaryFont: c.typography?.fontFamily || 'N/A',
    headingScale: c.typography?.headingScale || 'N/A'
  }));
}

function detectThemeType(colors: any) {
  if (!colors) return 'unknown';
  const primary = colors.primary || colors.brand;
  if (!primary) return 'neutral';

  // Simple theme detection based on color
  const darkColors = ['#000', '#111', '#1a1a1a'];
  const lightColors = ['#fff', '#fafafa', '#f5f5f5'];

  if (darkColors.includes(primary.toLowerCase())) return 'dark';
  if (lightColors.includes(primary.toLowerCase())) return 'light';
  return 'colorful';
}

function generateRecommendations(comparisons: any[]) {
  const recommendations = [];

  if (comparisons.length >= 3) {
    recommendations.push('Consider creating a hybrid design system combining elements from multiple brands');
  }

  const hasDarkTheme = comparisons.some(c => detectThemeType(c.colors) === 'dark');
  const hasLightTheme = comparisons.some(c => detectThemeType(c.colors) === 'light');

  if (hasDarkTheme && hasLightTheme) {
    recommendations.push('Implement theme switching capability based on user preference');
  }

  return recommendations;
}