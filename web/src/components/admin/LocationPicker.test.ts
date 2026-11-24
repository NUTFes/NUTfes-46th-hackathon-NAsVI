import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import LocationPicker from './LocationPicker.vue';

describe('LocationPicker', () => {
  it('未配置と輪郭を表示し、クリックを割合に変換する', async () => {
    const wrapper = mount(LocationPicker, { props: { outlines: ['M 10 10 L 30 10 L 30 30 Z'] } });
    expect(wrapper.text()).toContain('まだ置いていません');
    expect(wrapper.get('path').attributes('d')).toContain('M 10 10');
    const button = wrapper.get('button');
    vi.spyOn(button.element, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, width: 400, height: 200 } as DOMRect);
    await button.trigger('click', { clientX: 110, clientY: 170 });
    expect(wrapper.emitted('change')).toEqual([[{ x: 25, y: 75 }]]);
    await button.trigger('click', { clientX: 900, clientY: 0 });
    expect(wrapper.emitted('change')?.at(-1)).toEqual([{ x: 100, y: 0 }]);
    wrapper.unmount();
  });

  it('Enterで置き、矢印キーで範囲内を移動し、座標と旗を表示する', async () => {
    const wrapper = mount(LocationPicker);
    await wrapper.get('button').trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('change')).toEqual([[{ x: 50, y: 50 }]]);
    await wrapper.setProps({ value: { x: 100, y: 0 } });
    await wrapper.get('button').trigger('keydown', { key: 'ArrowRight' });
    expect(wrapper.emitted('change')?.at(-1)).toEqual([{ x: 100, y: 0 }]);
    await wrapper.get('button').trigger('keydown', { key: 'ArrowDown' });
    expect(wrapper.emitted('change')?.at(-1)).toEqual([{ x: 100, y: 1 }]);
    expect(wrapper.text()).toContain('横 100.00%、縦 0.00%');
    expect(wrapper.find('[data-icon="flag"]').exists()).toBe(true);
    await wrapper.setProps({ disabled: true });
    const count = wrapper.emitted('change')?.length;
    await wrapper.get('button').trigger('keydown', { key: 'ArrowLeft' });
    expect(wrapper.emitted('change')).toHaveLength(count!);
    wrapper.unmount();
  });
});
