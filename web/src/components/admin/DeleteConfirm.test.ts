import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import DeleteConfirm from './DeleteConfirm.vue';

describe('DeleteConfirm', () => {
  const props = { title: '「たこやき屋」を削除しますか？', effects: '検索・一覧から消え、案内も終わります。' };

  it('alertdialog として、見出しと連動して起きることに結び付く', () => {
    const wrapper = mount(DeleteConfirm, { props });
    expect(wrapper.attributes('role')).toBe('alertdialog');
    expect(wrapper.attributes('aria-labelledby')).toBe('delete-title');
    expect(wrapper.attributes('aria-describedby')).toBe('delete-effects');
    expect(wrapper.get('#delete-title').text()).toBe(props.title);
    expect(wrapper.get('#delete-effects').text()).toBe(props.effects);
  });

  it('「削除する」を左、「やめる」を右に並べる', () => {
    const wrapper = mount(DeleteConfirm, { props });
    expect(wrapper.findAll('button').map((b) => b.text())).toEqual(['削除する', 'やめる']);
    expect(wrapper.findAll('button')[0].classes()).toContain('nv-btn--danger');
  });

  it('それぞれ confirm・cancel を送る。通信中は押せない', async () => {
    const wrapper = mount(DeleteConfirm, { props });
    await wrapper.findAll('button')[0].trigger('click');
    await wrapper.findAll('button')[1].trigger('click');
    expect(wrapper.emitted('confirm')).toHaveLength(1);
    expect(wrapper.emitted('cancel')).toHaveLength(1);
    await wrapper.setProps({ busy: true });
    expect(wrapper.findAll('button').every((b) => b.attributes('disabled') !== undefined)).toBe(true);
  });

  it('最初のフォーカスは「やめる」', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const wrapper = mount(DeleteConfirm, { props, attachTo: host });
    (wrapper.vm as unknown as { focusCancel: () => void }).focusCancel();
    expect(document.activeElement?.textContent).toBe('やめる');
    wrapper.unmount();
    host.remove();
  });

  it('native の dialog の中では role を付けない（二重にしない）', () => {
    const wrapper = mount(DeleteConfirm, { props: { ...props, role: 'none' } });
    expect(wrapper.attributes('role')).toBeUndefined();
    expect(wrapper.attributes('aria-labelledby')).toBeUndefined();
  });
});
