import { Appearance, type ColorSchemeName } from 'react-native';

export type ThemeMode = 'light' | 'dark';

type Listener = (mode: ThemeMode) => void;

let currentTheme: ThemeMode = Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
const listeners = new Set<Listener>();

Appearance.addChangeListener(({ colorScheme }) => {
  applyTheme(colorScheme);
});

function applyTheme(scheme: ColorSchemeName): void {
  const next: ThemeMode = scheme === 'dark' ? 'dark' : 'light';
  if (next === currentTheme) return;
  currentTheme = next;
  listeners.forEach((l) => l(next));
}

export function getCurrentTheme(): ThemeMode {
  return currentTheme;
}

export function setCurrentTheme(mode: ThemeMode): void {
  if (mode === currentTheme) return;
  currentTheme = mode;
  listeners.forEach((l) => l(mode));
}

export function subscribeTheme(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
