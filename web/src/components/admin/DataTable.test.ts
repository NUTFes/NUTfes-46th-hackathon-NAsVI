import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import DataTable from './DataTable.vue';

const columns = [{ key: 'name', label: '名前' }, { key: 'state', label: '位置' }, { key: 'actions', label: '操作', align: 'end' as const }];
const rows = [{ id: 'a', name: 'PMC LIVE' }, { id: 'b', name: 'お化け屋敷' }];
const slots = {
  'cell-name': '<template #cell-name="{ row }">{{ row.name }}</template>',
  'cell-state': '設定済み',
  'cell-actions': '<template #cell-actions="{ row }"><button :aria-label="`${row.name}を編集`">編集</button></template>',
};

function render(props: Record<string, unknown> = {}) {
  return mount(DataTable, { props: { columns, rows, caption: '登録済みの場所', ...props }, slots });
}

describe('DataTable', () => {
  it('表として読める。見出し行と、先頭の列が行見出し', () => {
    const wrapper = render();
    expect(wrapper.findAll('thead th').map((th) => th.text())).toEqual(['名前', '位置', '操作']);
    expect(wrapper.get('caption').text()).toBe('登録済みの場所');
    expect(wrapper.findAll('tbody th[scope="row"]').map((th) => th.text())).toEqual(['PMC LIVE', 'お化け屋敷']);
  });

  it('選択中の行に aria-current が付き、他の行には付かない', () => {
    const wrapper = render({ selectedId: 'b' });
    const [first, second] = wrapper.findAll('tbody tr');
    expect(first.attributes('aria-current')).toBeUndefined();
    expect(second.attributes('aria-current')).toBe('true');
    expect(second.classes()).toContain('is-selected');
  });

  it('空のときは文言を 1 行で出す', () => {
    const wrapper = render({ rows: [] });
    expect(wrapper.get('tbody').text()).toBe('まだ登録されていません');
    expect(wrapper.get('tbody td').attributes('colspan')).toBe('3');
  });

  it('regionLabel を渡すとキーボードで動かせる領域になる', () => {
    const wrapper = render({ regionLabel: '場所の表' });
    expect(wrapper.attributes('role')).toBe('region');
    expect(wrapper.attributes('aria-label')).toBe('場所の表');
    expect(wrapper.attributes('tabindex')).toBe('0');
    expect(render().attributes('tabindex')).toBeUndefined();
  });

  it('操作の列は右寄せ', () => {
    const wrapper = render();
    expect(wrapper.get('tbody td:last-child').attributes('data-align')).toBe('end');
  });
});
