import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import FormField from './FormField.vue';

const slots = { default: '<input id="x" aria-invalid="true" aria-describedby="x-error">' };

describe('FormField', () => {
  it('ラベルを入力欄に結び付ける', () => {
    const wrapper = mount(FormField, { props: { label: '名前', controlId: 'x' }, slots });
    expect(wrapper.get('label').attributes('for')).toBe('x');
    expect(wrapper.get('label').text()).toBe('名前');
    expect(wrapper.find('p').exists()).toBe(false);
    expect(wrapper.attributes('data-invalid')).toBeUndefined();
  });

  it('エラーは文で出し、枠の色だけに頼らない（role は付けない）', () => {
    const wrapper = mount(FormField, { props: { label: '名前', controlId: 'x', error: '名前を入れてください', errorId: 'x-error' }, slots });
    const error = wrapper.get('#x-error');
    expect(error.text()).toBe('名前を入れてください');
    expect(error.attributes('role')).toBeUndefined();
    expect(wrapper.attributes('data-invalid')).toBe('true');
  });

  it('alert を指定したときだけエラーに role="alert" を付ける', () => {
    const wrapper = mount(FormField, { props: { label: '名前', controlId: 'x', error: 'だめ', errorId: 'x-error', alert: true }, slots });
    expect(wrapper.get('#x-error').attributes('role')).toBe('alert');
  });

  it('補足をエラーの前に出す', () => {
    const wrapper = mount(FormField, { props: { label: '階', controlId: 'x', help: '整数', helpId: 'x-help', error: 'だめ', errorId: 'x-error' }, slots });
    expect(wrapper.findAll('p').map((p) => p.attributes('id'))).toEqual(['x-help', 'x-error']);
  });
});
