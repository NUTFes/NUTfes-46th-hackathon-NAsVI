import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue';
import tokens from '../../../design-system/tokens.json';
import designTokens from '../../../design-system/claude-design/tokens.json';
import '../../../design-system/claude-design/tokens.css';

type Color = { hex: string; alpha?: number };
function cssColor(value: string | Color): string {
  if (typeof value === 'string') {
    const [, , hue, shade] = value.slice(1, -1).split('.');
    const palette = tokens.color.palette as Record<string, Record<string, { $value: Color }>>;
    return cssColor(palette[hue][shade].$value);
  }
  return value.hex + (value.alpha === undefined ? ''
    : Math.round(value.alpha * 255).toString(16).padStart(2, '0'));
}
const dimension = (value: { value: number; unit: string }) => `${value.value}${value.unit}`;
const COLOR_NAMES = [
  'bg-page', 'bg-surface', 'text-primary', 'text-secondary', 'action-primary',
  'action-on-primary', 'border-subtle', 'danger', 'danger-bg', 'danger-text', 'event',
] as const; // color.{dark,light}.<name>
const DTCG_COLOR_NAMES = [
  'action-selected-bg', 'destination', 'destination-on', 'destination-border', 'event-on',
  'parking', 'parking-on', 'facility', 'facility-on', 'feeling', 'feeling-on', 'map-ring',
  'congestion-border', 'state-pressed', 'text-disabled', 'skeleton', 'stale',
  'congestion-1', 'congestion-1-on', 'congestion-2', 'congestion-2-on', 'congestion-3',
  'congestion-3-on', 'congestion-4', 'congestion-4-on', 'congestion-5', 'congestion-5-on',
] as const; // color.{dark,light}.<name>（DTCG にある、残りの意味の色）
// DTCG 側に未収録の 3 つ（仮置き変数）。値は claude-design/tokens.json color.tokens から読む。
const PLACEHOLDER_NAMES = ['border-control', 'danger-on', 'destination-text'] as const;
type Theme = 'dark' | 'light';
type DesignToken = { name: string; value: string | { dark: string; light: string } };
const designColors = designTokens.color.tokens as DesignToken[];
function designColor(name: string, theme: Theme): string {
  const value = designColors.find(token => token.name === name)!.value;
  const color = typeof value === 'string' ? value : value[theme];
  const ref = /^\{(.+)\}$/.exec(color);
  return ref ? designColor(ref[1], theme) : color; // {violet-950} はパレットの項目名
}
/** 指定のテーマで --app-* に出す色すべて（検査用に公開）。 */
export function appColors(theme: Theme): Record<string, string> {
  return {
    ...Object.fromEntries(COLOR_NAMES.map(name =>
      [`--app-${name}`, cssColor(tokens.color[theme][name].$value)])),
    ...Object.fromEntries(DTCG_COLOR_NAMES.map(name =>
      [`--app-${name}`, cssColor(tokens.color[theme][name].$value)])),
    // claude-design/tokens.json color.tokens.{border-control,danger-on,destination-text}
    ...Object.fromEntries(PLACEHOLDER_NAMES.map(name => [`--app-${name}`, designColor(name, theme)])),
  };
}
export const APP_TOKENS = {
  '--app-space-1': dimension(tokens.space['1'].$value), // space.1
  '--app-space-2': dimension(tokens.space['2'].$value), // space.2
  '--app-space-3': dimension(tokens.space['3'].$value), // space.3
  '--app-space-4': dimension(tokens.space['4'].$value), // space.4
  '--app-tab-height': `calc(${dimension(tokens.space['6'].$value)} * 3)`, // space.6 × 3 / TabBar.md 72px
  '--app-radius': dimension(tokens.radius.lg.$value), // radius.lg
  '--app-touch': dimension(tokens.size['touch-target'].$value), // size.touch-target
  '--app-font': tokens.font.family.base.$value.map(value => value === 'sans-serif' ? value : JSON.stringify(value)).join(', '), // font.family.base
  '--app-body': dimension(tokens.font.size.sm.$value), // font.size.sm
  '--app-title': dimension(tokens.font.size['2xl'].$value), // font.size.2xl
  '--app-action': dimension(tokens.font.size.md.$value), // font.size.md
  '--app-input': dimension(tokens.font.size.xl.$value), // font.size.xl
  '--app-regular': tokens.font.weight.regular.$value, // font.weight.regular
  '--app-bold': tokens.font.weight.bold.$value, // font.weight.bold
  '--app-leading': '1.5', // claude-design/tokens.css .body
  '--app-disabled': tokens.opacity.disabled.$value, // opacity.disabled
} as const;

export function useAppTokens(root: Ref<HTMLElement | undefined>) {
  const theme = ref<Theme>('dark');
  let observer: MutationObserver | undefined;
  function resolveColors() {
    theme.value = root.value?.closest('[data-theme]')?.getAttribute('data-theme') === 'light'
      ? 'light' : 'dark';
  }
  onMounted(() => {
    resolveColors();
    observer = new MutationObserver(resolveColors);
    for (let element = root.value; element; element = element.parentElement ?? undefined) {
      observer.observe(element, { attributes: true, attributeFilter: ['data-theme'] });
    }
  });
  onBeforeUnmount(() => observer?.disconnect());
  return computed(() => ({ ...APP_TOKENS, ...appColors(theme.value) }));
}
