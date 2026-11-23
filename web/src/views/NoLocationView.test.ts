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
  vi.unstubAllGlobals();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(beaconMock).not.toHaveBeenCalled();
  expect(xhrMock).not.toHaveBeenCalled();
  expect(socketMock).not.toHaveBeenCalled();
  expect(eventSourceMock).not.toHaveBeenCalled();
});

describe('NoLocationView', () => {
  it('使えないこと・できなくなること・代わりにできることを帯に表示する', () => {
    const wrapper = mount(NoLocationView);
    const banner = wrapper.get('[role="alert"]');

    expect(banner.get('h1').text()).toBe('現在地が使えません');
    expect(banner.findAll('p').map((line) => line.text())).toEqual([
      '行き先への方角と距離、スタンプは使えません。',
      '検索・一覧・場所の情報は、このまま使えます。',
    ]);
    expect(banner.get('[aria-hidden="true"]').text()).toBe('!');
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
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
  });

  it('拒否されても説明とボタンを残し、もう一度許可を依頼できる', async () => {
    const wrapper = mount(NoLocationView);
    await wrapper.get('button').trigger('click');
    fail({ code: 1 } as GeolocationPositionError);
    await nextTick();

    expect(wrapper.get('[role="alert"]').text()).toContain('現在地が使えません');
    expect(clearWatch).toHaveBeenCalledExactlyOnceWith(0);
    await wrapper.get('button').trigger('click');
    expect(watchPosition).toHaveBeenCalledTimes(2);
  });

  it('位置取得に成功したら使えないという帯を消し、位置を表示・送信しない', async () => {
    const wrapper = mount(NoLocationView);
    await wrapper.get('button').trigger('click');
    succeed({
      coords: { latitude: 37.4252, longitude: 138.7788, accuracy: 12 },
      timestamp: 1_800_000_000_000,
    } as GeolocationPosition);
    await nextTick();

    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('37.4252');
    expect(wrapper.text()).not.toContain('138.7788');
  });

  it('位置取得機能がない端末でも説明と許可ボタンを表示し続ける', async () => {
    vi.stubGlobal('navigator', { sendBeacon: beaconMock });
    const wrapper = mount(NoLocationView);
    await wrapper.get('button').trigger('click');

    expect(wrapper.get('[role="alert"]').text()).toContain('検索・一覧・場所の情報は、このまま使えます。');
    expect(wrapper.get('button').element.disabled).toBe(false);
    expect(watchPosition).not.toHaveBeenCalled();
  });

  it('画面を閉じたら位置の監視を解放する', async () => {
    const wrapper = mount(NoLocationView);
    await wrapper.get('button').trigger('click');
    wrapper.unmount();

    expect(clearWatch).toHaveBeenCalledExactlyOnceWith(0);
  });
});
