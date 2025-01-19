import { initialPhysics, initialFilter, initialVisuals, initialBehavior, initialMouse, initialLocal, initialColoring } from '../components/config'

export interface OrgRoamUISettings {
  theme: {
    colorTheme: string;
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
  tagColors: Record<string, string>;
}

export const exportSettings = (): string => {
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
};

export const importSettings = (settingsJson: string): void => {
  try {
    const settings: OrgRoamUISettings = JSON.parse(settingsJson);
    
    // Theme - parse it only once
    const colorTheme = settings.theme.colorTheme;
    localStorage.setItem('colorTheme', colorTheme);
    localStorage.setItem('highlightColor', settings.theme.highlightColor);
    
    // Layout
    localStorage.setItem('sidebarWidth', JSON.stringify(settings.layout.sidebarWidth));
    localStorage.setItem('mainWindowWidth', JSON.stringify(settings.layout.mainWindowWidth));
    localStorage.setItem('showTweaks', JSON.stringify(settings.layout.showTweaks));
    localStorage.setItem('justification', JSON.stringify(settings.layout.justification));
    localStorage.setItem('outline', JSON.stringify(settings.layout.outline));
    
    // Other settings
    localStorage.setItem('physics', JSON.stringify(settings.physics));
    localStorage.setItem('filter', JSON.stringify(settings.filter));
    localStorage.setItem('visuals', JSON.stringify(settings.visuals));
    localStorage.setItem('behavior', JSON.stringify(settings.behavior));
    localStorage.setItem('mouse', JSON.stringify(settings.mouse));
    localStorage.setItem('local', JSON.stringify(settings.local));
    localStorage.setItem('coloring', JSON.stringify(settings.coloring));
    localStorage.setItem('tagCols', JSON.stringify(settings.tagColors));
  } catch (error) {
    console.error('Failed to import settings:', error);
    throw new Error('Invalid settings file format');
  }
};
