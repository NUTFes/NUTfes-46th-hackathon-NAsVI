import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import CameraLabel, { CAMERA_LABEL_CLASSES } from './CameraLabel.vue';

enableAutoUnmount(afterEach);

describe('CameraLabel', () => {
  it('place は名前と距離を出す', () => {
    const wrapper = mount(CameraLabel, { props: { label: 'PMC LIVE', distance: '90 m' } });
    expect(wrapper.text()).toBe('PMC LIVE90 m');
    expect(wrapper.classes()).not.toContain(CAMERA_LABEL_CLASSES.destination);
  });

  it('destination と far のクラスを付ける', () => {
    const wrapper = mount(CameraLabel, { props: { label: 'PMC LIVE', kind: 'destination', far: true } });
    expect(wrapper.classes()).toEqual(expect.arrayContaining([CAMERA_LABEL_CLASSES.destination, CAMERA_LABEL_CLASSES.far]));
    expect(wrapper.attributes('data-kind')).toBe('destination');
  });
});
