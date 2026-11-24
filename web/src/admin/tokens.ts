import source from '../../../design-system/tokens.json?raw';
import { APP_TOKENS, appColors } from '../app/tokens';

type TokenValue = string | number | string[]
  | { value: number; unit: string }
  | { hex: string; alpha?: number; components: number[] };
type TokenNode = { [key: string]: TokenNode | TokenValue; $value: TokenValue };
const tokens = JSON.parse(source) as TokenNode;

function token(path: string): string {
  const value = path.split('.').reduce((node, key) => node[key] as TokenNode, tokens).$value;
  if (typeof value === 'string') {
    return value.startsWith('{') ? token(value.slice(1, -1)) : value;
  }
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map((family) => family.includes(' ') ? JSON.stringify(family) : family).join(', ');
  if ('unit' in value) return `${value.value}${value.unit}`;
  if (value.alpha === undefined) return value.hex;
  return `rgb(${value.components.map((component) => component * 255).join(' ')} / ${value.alpha})`;
}

function color(name: string): string {
  return `light-dark(${token(`color.light.${name}`)}, ${token(`color.dark.${name}`)})`;
}

// ui/ の共通部品（Button・Badge・EmptyState など）は --app-* を読む。運営画面でも使えるよう、
// 運営画面の配色方式（light-dark でブラウザの配色設定に従う）のまま同じ名前で出す。
// 運営画面のテーマ（OS 追従かダーク固定か）は未決（#167）。決まるまでこの方式を維持する。
const light = appColors('light');
const dark = appColors('dark');
const appAliases = {
  ...APP_TOKENS,
  ...Object.fromEntries(Object.keys(light).map((name) => [name, `light-dark(${light[name]}, ${dark[name]})`])),
};

// 色・余白・文字の指定はここに集約する。値の正は design-system/tokens.json。
// light-dark はブラウザの配色設定に従い、両方の意味トークンを使う。
export const adminTokens = {
  ...appAliases,
  colorScheme: 'light dark',
  '--admin-bg': color('bg-page'), // color.{light,dark}.bg-page
  '--admin-surface': color('bg-surface'), // color.{light,dark}.bg-surface
  '--admin-text': color('text-primary'), // color.{light,dark}.text-primary
  '--admin-muted': color('text-secondary'), // color.{light,dark}.text-secondary
  '--admin-action': color('action-primary'), // color.{light,dark}.action-primary
  '--admin-selected': color('action-selected-bg'), // color.{light,dark}.action-selected-bg
  '--admin-border': color('border-subtle'), // color.{light,dark}.border-subtle
  '--admin-border-control': `light-dark(${light['--app-border-control']}, ${dark['--app-border-control']})`, // 入力欄・外枠のボタンの枠（claude-design/tokens.json border-control）
  '--admin-danger': color('danger'), // color.{light,dark}.danger
  '--admin-danger-bg': color('danger-bg'), // color.{light,dark}.danger-bg
  '--admin-danger-text': color('danger-text'), // color.{light,dark}.danger-text
  '--admin-space-xs': token('space.1'), // space.1
  '--admin-space-sm': token('space.2'), // space.2
  '--admin-space-md': token('space.3'), // space.3
  '--admin-space-lg': token('space.4'), // space.4
  '--admin-space-xl': token('space.6'), // space.6
  '--admin-radius': token('radius.sm'), // radius.sm
  '--admin-touch-target': token('size.touch-target'), // size.touch-target
  '--admin-font': token('font.family.base'), // font.family.base
  '--admin-body-size': token('font.size.md'), // font.size.md
  '--admin-label-size': token('font.size.xs'), // font.size.xs
  '--admin-title-size': token('font.size.3xl'), // font.size.3xl
  '--admin-banner-title-size': token('font.size.xl'), // font.size.xl
  '--admin-weight': token('font.weight.regular'), // font.weight.regular
  '--admin-bold': token('font.weight.bold'), // font.weight.bold
} as const;
