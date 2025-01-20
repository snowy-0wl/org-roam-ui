import { initialPhysics, initialFilter, initialVisuals, initialBehavior, initialMouse, initialLocal, initialColoring } from '../components/config'
import { themes } from '../components/themes'

// Theme type definitions
type ThemeName = keyof typeof themes;
type ThemeColors = typeof themes[ThemeName];
type ThemeTuple = [ThemeName, ThemeColors];

export interface OrgRoamUISettings {
  theme: {
    colorTheme: string | ThemeTuple;
    highlightColor: string;
  };
  layout: {
    sidebarWidth: number;
    mainWindowWidth: number;
    showTweaks: boolean;
    justification: number;
    outline: boolean;
  };
  physics: typeof initialPhysics;
  filter: typeof initialFilter;
  visuals: typeof initialVisuals;
  behavior: typeof initialBehavior;
  mouse: typeof initialMouse;
  local: typeof initialLocal;
  coloring: typeof initialColoring;
  tagColors: { [key: string]: string };
}

const DEFAULT_THEME: ThemeTuple = ['one-vibrant', themes['one-vibrant']];

const saveToStorage = (key: string, value: any) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error(`Failed to save ${key}:`, error);
    return false;
  }
};

export const importSettings = (settingsJson: string): void => {
  try {
    // Parse the input settings
    let settings: OrgRoamUISettings;
    try {
      settings = JSON.parse(settingsJson);
    } catch (parseError) {
      console.error('Failed to parse settings JSON:', parseError);
      throw new Error('Invalid JSON format');
    }

    // Validate required structure
    if (!settings?.theme) {
      throw new Error('Invalid settings: missing theme section');
    }

    // Create a batch of changes to apply
    const changes = new Map<string, any>();

    // Handle theme settings
    const { colorTheme } = settings.theme;
    let themeToSave = DEFAULT_THEME;

    if (typeof colorTheme === 'string') {
      try {
        const parsedTheme = JSON.parse(colorTheme);
        if (Array.isArray(parsedTheme) && parsedTheme.length === 2) {
          const [themeName] = parsedTheme;
          if (typeof themeName === 'string' && themeName in themes) {
            themeToSave = [themeName, themes[themeName as ThemeName]];
          }
        }
      } catch {
        if (typeof colorTheme === 'string' && colorTheme in themes) {
          themeToSave = [colorTheme, themes[colorTheme as ThemeName]];
        }
      }
    } else if (Array.isArray(colorTheme) && colorTheme.length === 2) {
      const [themeName] = colorTheme;
      if (typeof themeName === 'string' && themeName in themes) {
        themeToSave = [themeName, themes[themeName as ThemeName]];
      }
    }

    changes.set('colorTheme', themeToSave);

    // Handle highlight color
    const validHighlightColors = [
      'purple.500',
      'pink.500',
      'blue.500',
      'cyan.500',
      'green.500',
      'yellow.500',
      'orange.500',
      'red.500'
    ];
    
    const highlightColor = validHighlightColors.includes(settings.theme.highlightColor)
      ? settings.theme.highlightColor
      : 'purple.500';
    changes.set('highlightColor', highlightColor);

    // Handle layout settings
    if (settings.layout) {
      const { layout } = settings;
      if (typeof layout.sidebarWidth === 'number') {
        changes.set('sidebarWidth', layout.sidebarWidth);
      }
      if (typeof layout.mainWindowWidth === 'number') {
        changes.set('mainWindowWidth', layout.mainWindowWidth);
      }
      if (typeof layout.showTweaks === 'boolean') {
        changes.set('showTweaks', layout.showTweaks);
      }
      if (typeof layout.justification === 'number') {
        changes.set('justification', layout.justification);
      }
      if (typeof layout.outline === 'boolean') {
        changes.set('outline', layout.outline);
      }
    }

    // Handle complex settings objects
    const complexSettings = {
      physics: { ...initialPhysics, ...(settings.physics || {}) },
      filter: { ...initialFilter, ...(settings.filter || {}) },
      visuals: { ...initialVisuals, ...(settings.visuals || {}) },
      behavior: { ...initialBehavior, ...(settings.behavior || {}) },
      mouse: { ...initialMouse, ...(settings.mouse || {}) },
      local: { ...initialLocal, ...(settings.local || {}) },
      coloring: { ...initialColoring, ...(settings.coloring || {}) }
    };

    // Add complex settings to changes
    Object.entries(complexSettings).forEach(([key, value]) => {
      changes.set(key, value);
    });

    // Handle tag colors
    if (settings.tagColors && typeof settings.tagColors === 'object') {
      changes.set('tagCols', settings.tagColors);
    } else {
      changes.set('tagCols', {});
    }

    // Apply all changes atomically
    let success = true;
    changes.forEach((value, key) => {
      if (!saveToStorage(key, value)) {
        success = false;
      }
    });

    if (!success) {
      throw new Error('Failed to save some settings');
    }

    // Use a custom event to notify the app of settings changes
    if (typeof window !== 'undefined') {
      const event = new CustomEvent('settingsUpdated', {
        detail: {
          timestamp: Date.now(),
          changedKeys: Array.from(changes.keys())
        }
      });
      window.dispatchEvent(event);
    }

  } catch (error) {
    console.error('Failed to import settings:', error);
    // Ensure default theme is set even on error
    saveToStorage('colorTheme', DEFAULT_THEME);
    saveToStorage('highlightColor', 'purple.500');
    throw new Error(`Failed to import settings: ${error.message}`);
  }
};

// Helper function to get current settings
export const getCurrentSettings = (): OrgRoamUISettings => {
  const defaultTheme: ThemeTuple = DEFAULT_THEME;
  return {
    theme: {
      colorTheme: localStorage.getItem('colorTheme') || JSON.stringify(defaultTheme),
      highlightColor: localStorage.getItem('highlightColor') || 'purple.500',
    },
    layout: {
      sidebarWidth: JSON.parse(localStorage.getItem('sidebarWidth') || '400'),
      mainWindowWidth: JSON.parse(localStorage.getItem('mainWindowWidth') || '800'),
      showTweaks: JSON.parse(localStorage.getItem('showTweaks') || 'false'),
      justification: JSON.parse(localStorage.getItem('justification') || '1'),
      outline: JSON.parse(localStorage.getItem('outline') || 'false'),
    },
    physics: JSON.parse(localStorage.getItem('physics') || JSON.stringify(initialPhysics)),
    filter: JSON.parse(localStorage.getItem('filter') || JSON.stringify(initialFilter)),
    visuals: JSON.parse(localStorage.getItem('visuals') || JSON.stringify(initialVisuals)),
    behavior: JSON.parse(localStorage.getItem('behavior') || JSON.stringify(initialBehavior)),
    mouse: JSON.parse(localStorage.getItem('mouse') || JSON.stringify(initialMouse)),
    local: JSON.parse(localStorage.getItem('local') || JSON.stringify(initialLocal)),
    coloring: JSON.parse(localStorage.getItem('coloring') || JSON.stringify(initialColoring)),
    tagColors: JSON.parse(localStorage.getItem('tagCols') || '{}'),
  };
};

export const exportSettings = (): string => {
  try {
    const settings: OrgRoamUISettings = {
      theme: {
        colorTheme: localStorage.getItem('colorTheme') || '[]',
        highlightColor: localStorage.getItem('highlightColor') || '',
      },
      layout: {
        sidebarWidth: JSON.parse(localStorage.getItem('sidebarWidth') || '400'),
        mainWindowWidth: JSON.parse(localStorage.getItem('mainWindowWidth') || '800'),
        showTweaks: JSON.parse(localStorage.getItem('showTweaks') || 'false'),
        justification: JSON.parse(localStorage.getItem('justification') || '1'),
        outline: JSON.parse(localStorage.getItem('outline') || 'false'),
      },
      physics: JSON.parse(localStorage.getItem('physics') || JSON.stringify(initialPhysics)),
      filter: JSON.parse(localStorage.getItem('filter') || JSON.stringify(initialFilter)),
      visuals: JSON.parse(localStorage.getItem('visuals') || JSON.stringify(initialVisuals)),
      behavior: JSON.parse(localStorage.getItem('behavior') || JSON.stringify(initialBehavior)),
      mouse: JSON.parse(localStorage.getItem('mouse') || JSON.stringify(initialMouse)),
      local: JSON.parse(localStorage.getItem('local') || JSON.stringify(initialLocal)),
      coloring: JSON.parse(localStorage.getItem('coloring') || JSON.stringify(initialColoring)),
      tagColors: JSON.parse(localStorage.getItem('tagCols') || '{}'),
    };
    return JSON.stringify(settings, null, 2);
  } catch (error) {
    console.error('Failed to export settings:', error);
    throw new Error('Failed to export settings');
  }
};
