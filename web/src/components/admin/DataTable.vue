<script lang="ts">
export type DataTableColumn = { key: string; label: string; align?: 'start' | 'end' };
</script>

<script setup lang="ts" generic="Row extends { id: string }">
// 運営の一覧表。列は columns、各セルは slot `cell-<key>`（引数 { row }）で出す。
// 先頭の列は行見出し（th scope="row"）。表として読み上げられる。
withDefaults(defineProps<{
  columns: DataTableColumn[];
  rows: Row[];
  caption: string; // 表の名前（読み上げ用。画面には出さない）
  regionLabel?: string; // 指定すると、横に長い表をキーボードでスクロールできる領域にする
  selectedId?: string; // 編集中の行。薄い面になり aria-current が付く
  emptyText?: string;
}>(), { regionLabel: undefined, selectedId: undefined, emptyText: 'まだ登録されていません' });

defineSlots<{
  [cell: `cell-${string}`]: (props: { row: Row }) => unknown;
}>();

function align(column: DataTableColumn) {
  return column.align === 'end' ? 'end' : 'start';
}
</script>

<template>
  <div
    class="nv-table"
    :role="regionLabel ? 'region' : undefined"
    :aria-label="regionLabel"
    :tabindex="regionLabel ? 0 : undefined"
  >
    <table>
      <caption class="nv-table__caption">{{ caption }}</caption>
      <thead>
        <tr><th v-for="column in columns" :key="column.key" scope="col" :data-align="align(column)">{{ column.label }}</th></tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows" :key="row.id"
          :class="{ 'is-selected': row.id === selectedId }"
          :aria-current="row.id === selectedId ? 'true' : undefined"
        >
          <template v-for="(column, index) in columns" :key="column.key">
            <th v-if="index === 0" scope="row" :data-align="align(column)"><slot :name="`cell-${column.key}`" :row="row" /></th>
            <td v-else :data-align="align(column)"><slot :name="`cell-${column.key}`" :row="row" /></td>
          </template>
        </tr>
        <tr v-if="!rows.length"><td class="nv-table__empty" :colspan="columns.length">{{ emptyText }}</td></tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.nv-table {
  overflow-x: auto;
  border: thin solid var(--admin-border); /* border-subtle */
  border-radius: var(--admin-radius);
  background: var(--admin-surface); /* bg-surface */
}
.nv-table:focus-visible { outline: solid var(--admin-action); outline-offset: var(--admin-space-xs); }
table { width: 100%; border-collapse: collapse; }
.nv-table__caption { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
th, td { padding: var(--admin-space-md) var(--admin-space-lg); text-align: start; vertical-align: middle; border-bottom: thin solid var(--admin-border); overflow-wrap: anywhere; }
th[data-align='end'], td[data-align='end'] { text-align: end; }
thead th { color: var(--admin-muted); font-size: var(--admin-label-size); font-weight: var(--admin-bold); }
tbody th { font-weight: var(--admin-bold); }
tbody tr:last-child :is(th, td) { border-bottom: 0; }
tr.is-selected { background: var(--admin-selected); } /* action-selected-bg */
.nv-table__empty { color: var(--admin-muted); text-align: center; padding-block: var(--admin-space-xl); }
</style>
