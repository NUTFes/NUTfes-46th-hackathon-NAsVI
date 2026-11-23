import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import NoLocationView from './NoLocationView.vue';

enableAutoUnmount(afterEach);

let succeed: PositionCallback;
let fail: PositionErrorCallback;
const watchPosition = vi.fn<Geolocation['watchPosition']>();
const clearWatch = vi.fn<Geolocation['clearWatch']>();
const fetchMock = vi.fn(() => { throw new Error('外部通信は禁止'); });
const beaconMock = vi.fn(() => false);
const xhrMock = vi.fn(() => { throw new Error('外部通信は禁止'); });
const socketMock = vi.fn(() => { throw new Error('外部通信は禁止'); });
const eventSourceMock = vi.fn(() => { throw new Error('外部通信は禁止'); });
const hosts: HTMLElement[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  watchPosition.mockImplementation((success, error) => {
    succeed = success;
    fail = error!;
    return 0;
  });
  vi.stubGlobal('navigator', {
    geolocation: { watchPosition, clearWatch },
    sendBeacon: beaconMock,
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('XMLHttpRequest', xhrMock);
  vi.stubGlobal('WebSocket', socketMock);
  vi.stubGlobal('EventSource', eventSourceMock);
});

afterEach(() => {
  hosts.splice(0).forEach((host) => host.remove());
  vi.unstubAllGlobals();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(beaconMock).not.toHaveBeenCalled();
  expect(xhrMock).not.toHaveBeenCalled();
  expect(socketMock).not.toHaveBeenCalled();
  expect(eventSourceMock).not.toHaveBeenCalled();
});

describe('NoLocationView', () => {
  it('idle では現在地を使えないと断定せず、位置の利用を案内する', () => {
    const wrapper = mount(NoLocationView);
    const banner = wrapper.get('[role="status"]');

    expect(banner.get('h1').text()).toBe('現在地の利用を選べます');
    expect(banner.findAll('p').map((line) => line.text())).toEqual([
      '位置を利用すると、行き先への方角と距離、スタンプを使えます。',
      '検索・一覧・場所の情報は、このまま使えます。',
    ]);
    expect(banner.text()).not.toContain('使えません');
    expect(banner.findAll('button')).toHaveLength(1);
    expect(banner.text()).not.toContain('地図で指定');
  });

  it('表示しただけでは位置の許可を求めず、ボタンを押すと既存サービスで再依頼する', async () => {
    const wrapper = mount(NoLocationView);
    const button = wrapper.get('button');

    expect(watchPosition).not.toHaveBeenCalled();
    expect(button.text()).toBe('位置の利用を許可');
    expect(button.attributes('type')).toBe('button');
    await button.trigger('click');

    expect(watchPosition).toHaveBeenCalledExactlyOnceWith(
      expect.any(Function), expect.any(Function),
      expect.objectContaining({ enableHighAccuracy: true }),
    );
    expect(wrapper.get('h1').text()).toBe('位置情報の許可を確認しています');
    expect(wrapper.text()).toContain('端末やブラウザの許可画面を確認してください');
    expect(wrapper.text()).not.toContain('使えません');
    expect(button.text()).toBe('確認中…');
    expect(button.element.disabled).toBe(true);
    await button.trigger('click');
    expect(watchPosition).toHaveBeenCalledTimes(1);
  });

  it('拒否されても説明とボタンを残し、もう一度許可を依頼できる', async () => {
    const wrapper = mount(NoLocationView);
    await wrapper.get('button').trigger('click');
    fail({ code: 1 } as GeolocationPositionError);
    await nextTick();

    expect(wrapper.get('h1').text()).toBe('現在地の利用が許可されていません');
    expect(wrapper.text()).toContain('行き先への方角と距離、スタンプは使えません。');
    expect(wrapper.text()).toContain('検索・一覧・場所の情報は、このまま使えます。');
    expect(wrapper.get('[aria-hidden="true"]').text()).toBe('!');
    expect(wrapper.text()).toContain('許可画面が再表示されず反応がない場合があります');
    expect(wrapper.text()).toContain('iOS（Safari）:「設定」→「プライバシーとセキュリティ」→「位置情報サービス」');
    expect(wrapper.text()).toContain('「SafariのWebサイト」で使用中の位置情報を許可');
    expect(wrapper.text()).toContain('Android（Chrome）:「設定」→「位置情報」→「アプリの権限」→「Chrome」');
    expect(wrapper.text()).toContain('アドレスバー左側→「権限」でも位置情報を許可');
    expect(wrapper.text()).toContain('変更後、このページに戻って再依頼');
    expect(clearWatch).toHaveBeenCalledExactlyOnceWith(0);
    await wrapper.get('button').trigger('click');
    expect(watchPosition).toHaveBeenCalledTimes(2);
  });

  it.each([
    { code: 2, title: '現在地を取得できません', guidance: '端末の位置情報がオンか確認し' },
    { code: 3, title: '現在地の取得に時間がかかっています', guidance: 'もう一度試してください' },
  ])('一時エラー $code の説明を分け、再試行で監視を取り直す', async ({ code, title, guidance }) => {
    const wrapper = mount(NoLocationView);
    await wrapper.get('button').trigger('click');
    fail({ code } as GeolocationPositionError);
    await nextTick();

    expect(wrapper.get('h1').text()).toBe(title);
    expect(wrapper.text()).toContain(guidance);
    expect(wrapper.text()).toContain('行き先への方角と距離、スタンプは使えません。');
    expect(wrapper.text()).toContain('検索・一覧・場所の情報は、このまま使えます。');
    expect(wrapper.text()).not.toContain('iOS');
    expect(wrapper.text()).not.toContain('Android');
    expect(wrapper.get('button').text()).toBe('もう一度試す');
    expect(wrapper.get('button').element.disabled).toBe(false);
    expect(clearWatch).not.toHaveBeenCalled();
    await wrapper.get('button').trigger('click');
    expect(clearWatch).toHaveBeenCalledExactlyOnceWith(0);
    expect(watchPosition).toHaveBeenCalledTimes(2);
    expect(wrapper.get('h1').text()).toBe('位置情報の許可を確認しています');
  });

  it.each([1, 2, 3])('asking → エラー %i でも同じ live 領域の内容を更新する', async (code) => {
    const wrapper = mount(NoLocationView);
    const live = wrapper.get('[role="status"]');
    expect(live.attributes('aria-live')).toBe('polite');
    expect(live.attributes('aria-atomic')).toBe('true');
    await wrapper.get('button').trigger('click');
    const askingText = live.text();
    expect(wrapper.get('[role="status"]').element).toBe(live.element);
    fail({ code } as GeolocationPositionError);
    await nextTick();

    expect(wrapper.get('[role="status"]').element).toBe(live.element);
    expect(live.text()).not.toBe(askingText);
    expect(live.text()).not.toContain('許可を確認しています');
    expect(live.text()).toContain('スタンプは使えません');
  });

  it('位置取得に成功したら使えないという帯を消し、位置を表示・送信しない', async () => {
    const wrapper = mount(NoLocationView);
    const live = wrapper.get('[role="status"]').element;
    await wrapper.get('button').trigger('click');
    succeed({
      coords: { latitude: 37.4252, longitude: 138.7788, accuracy: 12 },
      timestamp: 1_800_000_000_000,
    } as GeolocationPosition);
    await nextTick();

    expect(wrapper.find('.no-location__banner').exists()).toBe(false);
    expect(wrapper.get('[role="status"]').element).toBe(live);
    expect(wrapper.get('[role="status"]').text()).toBe('');
    expect(wrapper.text()).not.toContain('37.4252');
    expect(wrapper.text()).not.toContain('138.7788');
  });

  it('位置取得機能がない端末でも説明と再試行ボタンを表示し続ける', async () => {
    vi.stubGlobal('navigator', { sendBeacon: beaconMock });
    const wrapper = mount(NoLocationView);
    await wrapper.get('button').trigger('click');

    expect(wrapper.get('h1').text()).toBe('現在地を取得できません');
    expect(wrapper.get('[role="status"]').text()).toContain('検索・一覧・場所の情報は、このまま使えます。');
    expect(wrapper.get('button').text()).toBe('もう一度試す');
    expect(wrapper.get('button').element.disabled).toBe(false);
    expect(watchPosition).not.toHaveBeenCalled();
  });

  it('一時エラー後に同じ監視で回復しても帯を消す', async () => {
    const wrapper = mount(NoLocationView);
    await wrapper.get('button').trigger('click');
    fail({ code: 3 } as GeolocationPositionError);
    await nextTick();
    succeed({
      coords: { latitude: 37.4252, longitude: 138.7788, accuracy: 12 },
      timestamp: 1_800_000_000_000,
    } as GeolocationPosition);
    await nextTick();

    expect(wrapper.find('.no-location__banner').exists()).toBe(false);
    expect(wrapper.text()).toBe('');
    expect(watchPosition).toHaveBeenCalledTimes(1);
  });

  it('画面を閉じたら位置の監視を解放する', async () => {
    const wrapper = mount(NoLocationView);
    await wrapper.get('button').trigger('click');
    wrapper.unmount();

    expect(clearWatch).toHaveBeenCalledExactlyOnceWith(0);
  });
});

const expectedColors = {
  dark: ['#f87171', '#2d1520', '#fecaca', '#f4f0ff', '#a78bfa', '#1e0b3a', '#ffffff1f'],
  light: ['#dc2626', '#fef2f2', '#b91c1c', '#1e0b3a', '#6d28d9', '#ffffff', '#1e0b3a14'],
};
const colorProperties = [
  '--noloc-border', '--noloc-background', '--noloc-text', '--noloc-heading',
  '--noloc-action', '--noloc-on-action', '--noloc-pressed',
];

function createHost(theme?: string, parent = document.body) {
  const host = document.createElement('div');
  if (theme !== undefined) host.setAttribute('data-theme', theme);
  parent.appendChild(host);
  hosts.push(host);
  return host;
}

function readColors(element: HTMLElement) {
  return colorProperties.map((property) => element.style.getPropertyValue(property));
}

describe('NoLocationView のテーマ', () => {
  it.each([
    { theme: undefined, expected: 'dark' },
    { theme: 'dark', expected: 'dark' },
    { theme: 'light', expected: 'light' },
    { theme: '', expected: 'dark' },
    { theme: 'unknown', expected: 'dark' },
  ] as const)('$theme の全色に $expected のトークン値を使う', async ({ theme, expected }) => {
    const wrapper = mount(NoLocationView, { attachTo: createHost(theme) });
    await nextTick();

    expect(readColors(wrapper.get('main').element)).toEqual(expectedColors[expected]);
  });

  it.each([
    { outer: 'light', inner: 'dark', expected: 'dark' },
    { outer: 'dark', inner: 'light', expected: 'light' },
    { outer: 'light', inner: 'unknown', expected: 'dark' },
    { outer: 'light', inner: '', expected: 'dark' },
  ] as const)('外側 $outer より最寄りの $inner を優先する', async ({ outer, inner, expected }) => {
    const wrapper = mount(NoLocationView, { attachTo: createHost(inner, createHost(outer)) });
    await nextTick();

    expect(readColors(wrapper.get('main').element)).toEqual(expectedColors[expected]);
  });

  it('テーマ属性の変更・追加・削除に追随する', async () => {
    const outer = createHost('dark');
    const inner = createHost(undefined, outer);
    const wrapper = mount(NoLocationView, { attachTo: inner });
    const main = wrapper.get('main').element;
    await nextTick();
    expect(readColors(main)).toEqual(expectedColors.dark);

    outer.setAttribute('data-theme', 'light');
    await vi.waitFor(() => expect(readColors(main)).toEqual(expectedColors.light));
    inner.setAttribute('data-theme', 'unknown');
    await vi.waitFor(() => expect(readColors(main)).toEqual(expectedColors.dark));
    inner.setAttribute('data-theme', 'light');
    await vi.waitFor(() => expect(readColors(main)).toEqual(expectedColors.light));
    inner.setAttribute('data-theme', 'dark');
    await vi.waitFor(() => expect(readColors(main)).toEqual(expectedColors.dark));
    inner.removeAttribute('data-theme');
    await vi.waitFor(() => expect(readColors(main)).toEqual(expectedColors.light));
    outer.removeAttribute('data-theme');
    await vi.waitFor(() => expect(readColors(main)).toEqual(expectedColors.dark));
  });
});
