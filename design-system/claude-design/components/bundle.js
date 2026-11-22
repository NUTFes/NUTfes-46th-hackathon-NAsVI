/* @ds-bundle: {"format":4,"namespace":"NAsVI","components":[{"name":"Button"},{"name":"IconButton"},{"name":"Chip"},{"name":"TabBar"},{"name":"SearchField"},{"name":"FilterBand"},{"name":"Banner"},{"name":"Toast"},{"name":"Badge"},{"name":"CheckRow"},{"name":"EmptyState"},{"name":"Icon"},{"name":"BuildingFlag"},{"name":"EventMark"},{"name":"FacilityMark"},{"name":"ParkingMark"},{"name":"StampMark"},{"name":"PositionMark"},{"name":"DestinationMark"},{"name":"PlaceRow"},{"name":"PlaceCard"},{"name":"DestinationCard"},{"name":"DestinationBar"},{"name":"Sheet"},{"name":"StampCongestionPicker"},{"name":"StampFeelingButton"},{"name":"MyStampRow"},{"name":"TagCreateField"},{"name":"BuildingFloorTabs"},{"name":"BuildingFloorPlan"},{"name":"BuildingCameraOverlay"},{"name":"DataTable"},{"name":"FormField"},{"name":"LocationPicker"},{"name":"BuildingShapePreview"},{"name":"DeleteConfirm"}]} */
(function () {
  'use strict';
  var React = window.React;
  var h = React.createElement;
  var Fr = React.Fragment;

  function cx() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) out.push(arguments[i]);
    return out.join(' ');
  }
  function omit(o, keys) {
    var r = {};
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k) && keys.indexOf(k) < 0) r[k] = o[k];
    return r;
  }
  function at(x, y, style) {
    if (x == null || y == null) return style;
    return Object.assign({ left: x, top: y }, style || {});
  }

  /* ---------------- Icon: ワイヤーフレームのアイコン(24 の格子、線で描く) ---------------- */
  var I = {
    search: { sw: 2, d: [['circle', { cx: 11, cy: 11, r: 7 }], ['path', { d: 'm20 20-3.5-3.5' }]] },
    'search-off': { sw: 1.6, d: [['circle', { cx: 11, cy: 11, r: 7 }], ['path', { d: 'm20 20-3.5-3.5M8.5 8.5l5 5M13.5 8.5l-5 5' }]] },
    close: { sw: 2, d: [['path', { d: 'M6 6l12 12M18 6 6 18' }]] },
    locate: { sw: 2, d: [['path', { d: 'M20 4 4 11l7 2 2 7z' }]] },
    'locate-off': { sw: 2, d: [['path', { d: 'M20 4 4 11l7 2 2 7z' }], ['path', { d: 'M3 3l18 18' }]] },
    'zoom-in': { sw: 2.4, d: [['path', { d: 'M12 5v14M5 12h14' }]] },
    'zoom-out': { sw: 2.4, d: [['path', { d: 'M5 12h14' }]] },
    plus: { sw: 2.4, d: [['path', { d: 'M12 5v14M5 12h14' }]] },
    layers: { sw: 2, d: [['path', { d: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z' }], ['circle', { cx: 12, cy: 12, r: 3 }]] },
    stamp: { sw: 2.2, d: [['path', { d: 'M9 4h6v6l3 3v2H6v-2l3-3z' }], ['path', { d: 'M5 20h14' }]] },
    list: { sw: 1.9, d: [['path', { d: 'M9 6h11M9 12h11M9 18h11' }], ['circle', { cx: 4.5, cy: 6, r: 1, fill: 'currentColor' }], ['circle', { cx: 4.5, cy: 12, r: 1, fill: 'currentColor' }], ['circle', { cx: 4.5, cy: 18, r: 1, fill: 'currentColor' }]] },
    map: { sw: 1.9, d: [['path', { d: 'M12 3 21 8l-9 5-9-5z' }], ['path', { d: 'm3 12 9 5 9-5M3 16l9 5 9-5' }]] },
    camera: { sw: 1.9, d: [['path', { d: 'M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2' }], ['circle', { cx: 12, cy: 12, r: 3 }]] },
    filter: { sw: 2, d: [['path', { d: 'M4 5h16l-6 7v6l-4 2v-8z' }]] },
    star: { sw: 2, fillable: true, d: [['path', { d: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z' }]] },
    bookmark: { sw: 2, fillable: true, d: [['path', { d: 'M6.5 3.5h11v17l-5.5-3.8-5.5 3.8z' }]] },
    tag: { sw: 1.9, d: [['path', { d: 'M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3-8.7 8.7z' }], ['circle', { cx: 8, cy: 8, r: 1.3, fill: 'currentColor', stroke: 'none' }]] },
    check: { sw: 2.6, d: [['path', { d: 'm5 12 5 5 9-10' }]] },
    'chevron-right': { sw: 2.4, d: [['path', { d: 'M9 5l7 7-7 7' }]] },
    navigation: { sw: 2.4, fillable: true, d: [['path', { d: 'M12 2 21 21 12 16.5 3 21Z' }]] },
    flag: { sw: 3, d: [['path', { d: 'M6 21V4M6 4h11l-2.5 4L17 12H6' }]] },
    info: { sw: 2.2, d: [['path', { d: 'M12 2.8a9.2 9.2 0 1 0 0 18.4a9.2 9.2 0 1 0 0-18.4zM12 10.8v6M12 7.3v.3' }]] },
    wc: { sw: 0.4, filled: true, d: [['path', { d: 'M7 2.2a2 2 0 1 1 0 4a2 2 0 1 1 0-4zM5.6 7.2h2.8a1.2 1.2 0 0 1 1.2 1.2V14H4.4V8.4a1.2 1.2 0 0 1 1.2-1.2zM4.9 14h1.8v7H4.9zM7.3 14h1.8v7H7.3zM17 2.2a2 2 0 1 1 0 4a2 2 0 1 1 0-4zM15.8 7.2h2.4l2.9 8.2h-8.2zM15.2 15.4h1.6V21h-1.6zM17.2 15.4h1.6V21h-1.6zM11.55 3h0.9v18h-0.9z' }]] },
    rest: { sw: 2.2, d: [['path', { d: 'M5 7h14M4 12h16M7 7v5M17 7v5M6 12v6M18 12v6' }]] },
    trash: { sw: 2.2, d: [['path', { d: 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12' }]] },
    fun: { sw: 2.6, d: [['path', { d: 'M8 14c1 2 2.4 3 4 3s3-1 4-3M9 9v.5M15 9v.5' }]] },
    food: { sw: 2, d: [['path', { d: 'M7 3v5a2 2 0 0 0 4 0V3M9 3v18M17 3c-1.7 0-3 2-3 4.5S15.3 12 17 12s3-2 3-4.5S18.7 3 17 3zM17 12v9' }]] },
    good: { sw: 1.9, d: [['path', { d: 'M7 11v9H4v-9zM7 11l4-7c1.5 0 2.5 1 2.2 2.6L12.5 10H18a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 16.8 20H7' }]] },
    alert: { sw: 2.2, d: [['path', { d: 'M12 3 22 20H2z' }], ['path', { d: 'M12 10v4M12 17v.3' }]] }
  };
  var ICON_NAMES = Object.keys(I);

  function Icon(p) {
    var spec = I[p.name];
    if (!spec) return null;
    var size = p.size || 20;
    var solid = spec.filled || (p.filled && spec.fillable);
    var kids = spec.d.map(function (e, i) {
      var a = Object.assign({ key: i }, e[1]);
      if (solid && e[0] === 'path' && !('fill' in e[1])) a.fill = 'currentColor';
      return h(e[0], a);
    });
    var a11y = p.label ? { role: 'img', 'aria-label': p.label } : { 'aria-hidden': 'true' };
    return h('svg', Object.assign({
      className: cx('nv-icon', p.className), width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', strokeWidth: p.strokeWidth || spec.sw, strokeLinecap: 'round', strokeLinejoin: 'round',
      style: Object.assign(p.color ? { color: p.color } : {}, p.rotate ? { transform: 'rotate(' + p.rotate + 'deg)' } : {}, p.style || {})
    }, a11y), kids);
  }
  Icon.names = ICON_NAMES;

  /* ---------------- 時刻の言い方 ---------------- */
  function minutesSince(t) {
    if (t == null) return null;
    var ms = t instanceof Date ? t.getTime() : (typeof t === 'number' ? t : Date.parse(t));
    if (isNaN(ms)) return null;
    return Math.max(0, Math.floor((Date.now() - ms) / 60000));
  }
  function secondsSince(t) {
    var ms = t instanceof Date ? t.getTime() : (typeof t === 'number' ? t : Date.parse(t));
    return isNaN(ms) ? null : Math.max(0, Math.round((Date.now() - ms) / 1000));
  }
  function agoShort(t) { var m = minutesSince(t); return m == null ? '' : m < 1 ? '今' : m + '分'; }
  function agoLong(t) { var m = minutesSince(t); return m == null ? '' : m < 1 ? 'たった今' : m + ' 分前'; }
  function untilLong(t) {
    if (t == null) return '';
    var ms = t instanceof Date ? t.getTime() : (typeof t === 'number' ? t : Date.parse(t));
    var m = Math.ceil((ms - Date.now()) / 60000);
    return m > 0 ? m + ' 分で消えます' : 'まもなく消えます';
  }
  function meters(m) { return m == null ? null : Math.round(m); }
  var DIRS = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
  function dirWord(deg) { return DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]; }

  /* ---------------- 基本の部品 ---------------- */
  function Button(p) {
    var rest = omit(p, ['variant', 'label', 'icon', 'size', 'onPress', 'children', 'className', 'iconFilled']);
    return h('button', Object.assign({ type: 'button' }, rest, {
      className: cx('nv-btn', 'nv-btn--' + (p.variant || 'primary'), p.size && p.size !== 'md' && 'nv-btn--' + p.size, p.className),
      onClick: p.onPress, disabled: p.disabled
    }), p.icon ? h(Icon, { name: p.icon, size: p.size === 'lg' ? 18 : 16, filled: p.iconFilled }) : null, p.label != null ? p.label : p.children);
  }

  function IconButton(p) {
    var rest = omit(p, ['icon', 'label', 'onPress', 'className', 'plain', 'size']);
    return h('button', Object.assign({ type: 'button' }, rest, {
      className: cx('nv-ibtn', p.plain && 'nv-ibtn--plain', p.className), 'aria-label': p.label, title: p.label,
      onClick: p.onPress, disabled: p.disabled
    }), h(Icon, { name: p.icon, size: p.size || 20 }));
  }

  function Chip(p) {
    return h('button', {
      type: 'button', className: cx('nv-chip', p.className), 'aria-pressed': p.selected ? 'true' : 'false',
      'data-source': p.source, onClick: p.onToggle
    }, p.selected ? h(Icon, { name: 'check', size: 12 }) : null, p.label);
  }

  var TABS = [['list', '一覧', 'list'], ['map', 'マップ', 'map'], ['camera', 'カメラ', 'camera']];
  function TabBar(p) {
    var cur = p.current || 'map';
    return h('nav', { className: cx('nv-tabbar', p.className), 'aria-label': '画面の切り替え' }, TABS.map(function (t) {
      return h('button', {
        key: t[0], type: 'button', className: 'nv-tab', 'aria-current': cur === t[0] ? 'page' : undefined,
        onClick: function () { if (p.onChange) p.onChange(t[0]); }
      }, h(Icon, { name: t[2], size: 24 }), t[1]);
    }));
  }

  function SearchField(p) {
    var ph = p.placeholder || '企画・場所を検索';
    return h('label', { className: cx('nv-search', p.className) },
      h(Icon, { name: 'search', size: 20 }),
      h('input', {
        type: 'search', value: p.value || '', placeholder: ph, 'aria-label': ph,
        onChange: function (e) { if (p.onChange) p.onChange(e.target.value); }
      }),
      p.value ? h(IconButton, { icon: 'close', label: '入力を消す', plain: true, size: 18, onPress: p.onClear, style: { width: 36, height: 36 } }) : null,
      p.naturalSearch ? h('button', { type: 'button', className: 'nv-search-natural' }, '文章で探す(拡張)') : null);
  }

  function FilterBand(p) {
    var labels = p.labels || [];
    var empty = p.count === 0 && p.emptyHint;
    var text = labels.map(function (l) { return '「' + l + '」'; }).join('・') + 'で絞り込み中' + (p.count != null ? '・' + p.count + ' 件' : '');
    return h('div', { role: 'status', className: cx('nv-band', empty && 'nv-band--empty', p.className) },
      h(Icon, { name: 'filter', size: 16 }),
      h('span', { className: 'nv-band-text' }, h('span', null, text), empty ? h('span', { className: 'nv-band-hint' }, p.emptyHint) : null),
      h('button', { type: 'button', className: 'nv-band-clear', onClick: p.onClear }, '解除'));
  }

  function actionButtons(actions, firstVariant) {
    return (actions || []).slice(0, 3).map(function (a, i) {
      return h(Button, { key: i, variant: a.variant || (i === 0 ? firstVariant : 'secondary'), label: a.label, icon: a.icon, onPress: a.onPress, disabled: a.disabled });
    });
  }

  function Banner(p) {
    var tone = p.tone || 'warning';
    return h('section', { role: tone === 'error' ? 'alert' : 'status', className: cx('nv-banner', 'nv-banner--' + tone, p.className), 'aria-label': p.title },
      h('div', { className: 'nv-banner-head' },
        h(Icon, { name: p.icon || (tone === 'error' ? 'alert' : 'info'), size: 22 }),
        h('div', null, h('p', { className: 'nv-banner-title' }, p.title), p.body ? h('p', { className: 'nv-banner-body' }, p.body) : null)),
      p.actions && p.actions.length ? h('div', { className: 'nv-actions' }, actionButtons(p.actions.slice(0, 2), 'danger')) : null);
  }

  function Toast(p) {
    return h('div', { role: 'status', className: cx('nv-toast', p.className) },
      h('span', { className: 'nv-toast-msg' }, p.message),
      p.onUndo ? h(Button, { variant: 'secondary', size: 'sm', label: p.undoLabel || '取り消す', onPress: p.onUndo }) : null);
  }

  function Badge(p) {
    return h('span', { className: cx('nv-badge', p.tone && p.tone !== 'neutral' && 'nv-badge--' + p.tone, p.className) }, p.label);
  }

  function CheckRow(p) {
    var icon = typeof p.icon === 'string' ? h(Icon, { name: p.icon, size: 20 }) : p.icon;
    return h('button', {
      type: 'button', role: 'checkbox', 'aria-checked': p.checked ? 'true' : 'false',
      className: cx('nv-check', p.className), onClick: p.onToggle
    },
      icon ? h('span', { className: 'nv-check-ic' }, icon) : null,
      h('span', { className: 'nv-check-text' }, h('span', { className: 'nv-check-label' }, p.label), p.sublabel ? h('span', { className: 'nv-check-sub' }, p.sublabel) : null),
      h('span', { className: 'nv-check-box', 'aria-hidden': 'true' }, p.checked ? h(Icon, { name: 'check', size: 15, strokeWidth: 3 }) : null));
  }

  function EmptyState(p) {
    var acts = p.actions || [];
    return h('section', { className: cx('nv-empty', p.className), 'aria-label': typeof p.title === 'string' ? p.title : undefined },
      h(Icon, { name: p.icon || 'search-off', size: 40 }),
      h('p', { className: 'nv-empty-title' }, p.title),
      p.body ? h('p', { className: 'nv-empty-body' }, p.body) : null,
      acts.length ? h('div', { className: 'nv-empty-actions' },
        h(Button, { variant: acts[0].variant || 'primary', label: acts[0].label, onPress: acts[0].onPress }),
        acts.length > 1 ? h('div', { className: 'nv-actions' }, acts.slice(1).map(function (a, i) { return h(Button, { key: i, variant: a.variant || 'secondary', label: a.label, onPress: a.onPress }); })) : null) : null);
  }

  /* ---------------- 地図の印 ---------------- */
  function BuildingFlag(p) {
    return h('button', {
      type: 'button', 'data-building': p.buildingId,
      className: cx('nv-mark', 'nv-flag', p.selected && 'nv-flag--selected', p.isDestination && 'nv-flag--dest', p.x != null && 'nv-mark--at', p.className),
      style: at(p.x, p.y), 'aria-label': (p.name || '建物') + '・企画 ' + p.count + ' 件' + (p.isDestination ? '・行き先' : '') + (p.selected ? '・選択中' : ''),
      'aria-pressed': p.selected ? 'true' : 'false', onClick: p.onPress
    }, h(Icon, { name: 'flag', size: 12, strokeWidth: 3 }), p.count);
  }

  function EventMark(p) {
    var dot = h('span', { className: cx('nv-mark', 'nv-dot', 'nv-event', p.zoomed && 'nv-event--zoomed') },
      h(Icon, { name: 'flag', size: p.zoomed ? 12 : 10, strokeWidth: 3 }));
    if (!p.zoomed) return h('span', { role: 'img', 'aria-label': '屋外の企画: ' + p.name, 'data-place': p.placeId, className: cx(p.x != null && 'nv-mark--at', p.className), style: at(p.x, p.y, { display: 'inline-flex' }) }, dot);
    return h('span', { role: 'img', 'aria-label': '屋外の企画: ' + p.name, 'data-place': p.placeId, className: cx('nv-mark-wrap', p.x != null && 'nv-mark--at', p.className), style: at(p.x, p.y) },
      dot, h('span', { className: 'nv-maplabel', 'aria-hidden': 'true' }, p.name));
  }

  var FAC_NAME = { info: '案内所', wc: 'トイレ', rest: '休憩所', trash: 'ゴミ箱' };
  function FacilityMark(p) {
    return h('span', { role: 'img', 'aria-label': FAC_NAME[p.kind] || '設備', className: cx('nv-mark', 'nv-dot', 'nv-fac', p.zoomed && 'nv-fac--zoomed', p.x != null && 'nv-mark--at', p.className), style: at(p.x, p.y) },
      h(Icon, { name: p.kind, size: p.zoomed ? 16 : 13 }));
  }

  function ParkingMark(p) {
    return h('span', { role: 'img', 'aria-label': '駐車場', 'data-place': p.placeId, className: cx('nv-mark', 'nv-park', p.x != null && 'nv-mark--at', p.className), style: at(p.x, p.y) }, 'P');
  }

  var FEEL = { fun: '面白い', food: '美味しい', good: 'よさ' };
  function stampInfo(kind) {
    var m = /^congestion-([1-5])$/.exec(kind || '');
    if (m) return { cg: true, n: Number(m[1]), name: '混雑' + m[1], bg: 'var(--congestion-' + m[1] + ')', fg: 'var(--congestion-' + m[1] + '-on)' };
    return { cg: false, key: kind, name: FEEL[kind] || kind, bg: 'var(--feeling)', fg: 'var(--feeling-on)' };
  }
  function StampMark(p) {
    var s = stampInfo(p.kind);
    var age = agoShort(p.pressedAt);
    var more = p.more > 0 ? '+' + p.more : null;
    var aria = (s.cg ? s.name : '感想「' + s.name + '」') + '・' + (age === '今' ? 'たった今' : age + '前') + (more ? '・ほか ' + p.more + ' 件' : '');
    var pos = cx(p.x != null && 'nv-mark--at', p.className);
    if (p.zoomed) {
      if (s.cg) return h('span', { role: 'img', 'aria-label': aria, className: cx('nv-mark', 'nv-stamp-pill', pos), style: at(p.x, p.y, { background: s.bg, color: s.fg }) },
        s.name, h('span', { className: 'nv-stamp-age' }, age), more ? h('span', null, more) : null);
      return h('span', { role: 'img', 'aria-label': aria, className: cx('nv-mark', 'nv-stamp-pill', 'nv-stamp-pill--feel', pos), style: at(p.x, p.y) },
        h(Icon, { name: s.key, size: 14 }), s.name, h('span', { className: 'nv-stamp-age' }, age));
    }
    if (s.cg) return h('span', { role: 'img', 'aria-label': aria, className: cx('nv-mark', 'nv-dot', 'nv-stamp-cg', pos), style: at(p.x, p.y, { background: s.bg }) },
      more ? h('span', { className: 'nv-stamp-more', 'aria-hidden': 'true' }, more) : null);
    return h('span', { role: 'img', 'aria-label': aria, className: cx('nv-mark', 'nv-dot', 'nv-stamp-feel', pos), style: at(p.x, p.y) }, h(Icon, { name: s.key, size: 13 }));
  }

  function PositionMark(p) {
    var aria = '現在地' + (p.accuracyM != null ? '・精度 ±' + meters(p.accuracyM) + ' m' : '') + (p.stale ? '・古い位置' : '');
    return h('span', { role: 'img', 'aria-label': aria, className: cx('nv-pos', p.stale && 'nv-pos--stale', p.x != null && 'nv-mark--at', p.className), style: at(p.x, p.y) },
      h('span', { className: 'nv-pos-acc' }), h('span', { className: 'nv-pos-ring' }),
      h('svg', { width: 24, height: 24, viewBox: '0 0 24 24', 'aria-hidden': 'true' },
        h('path', {
          d: 'M12 2 21 21 12 16.5 3 21Z', fill: p.stale ? 'var(--text-disabled)' : 'var(--facility)', stroke: 'var(--facility-on)', strokeWidth: 2, strokeLinejoin: 'round',
          transform: 'rotate(' + (p.headingDeg || 0) + ' 12 12)', style: p.headingDeg == null ? { display: p.stale ? 'none' : undefined } : undefined
        })));
  }

  function DestinationMark(p) {
    var showLine = p.showLine !== false;
    return h('span', { role: 'img', 'aria-label': '行き先' + (p.name ? ': ' + p.name : ''), 'data-place': p.placeId, className: cx('nv-dest', p.x != null && 'nv-mark--at', p.className), style: at(p.x, p.y) },
      showLine ? h('span', { className: 'nv-dest-line', 'aria-hidden': 'true', style: { width: p.lineLength || 96, transform: 'rotate(' + (p.lineAngleDeg != null ? p.lineAngleDeg : 150) + 'deg)' } }) : null,
      h('span', { className: 'nv-mark nv-dot nv-dest-pin' }, h(Icon, { name: 'flag', size: 13, strokeWidth: 3 })));
  }

  /* ---------------- 画面の部品 ---------------- */
  function highlight(name, q) {
    if (!q) return name;
    var i = name.indexOf(q);
    if (i < 0) return name;
    return h(Fr, null, name.slice(0, i), h('mark', null, name.slice(i, i + q.length)), name.slice(i + q.length));
  }
  function tagButtons(tags, onToggleTag, cls) {
    if (!tags) return null;
    return [['wantToGo', 'bookmark', '行きたい場所'], ['favorite', 'star', 'お気に入り']].map(function (t) {
      var on = !!tags[t[0]];
      return h('button', {
        key: t[0], type: 'button', className: cls, 'aria-pressed': on ? 'true' : 'false',
        'aria-label': cls === 'nv-row-tag' ? (on ? t[2] + 'から外す' : t[2] + 'に入れる') : undefined,
        onClick: function () { if (onToggleTag) onToggleTag(t[0], !on); }
      }, h(Icon, { name: t[1], size: cls === 'nv-row-tag' ? 20 : 15, filled: on }), cls === 'nv-row-tag' ? null : t[2]);
    });
  }

  function PlaceRow(p) {
    if (p.loading) return h('div', { className: 'nv-row', 'aria-busy': 'true' },
      h('div', { className: 'nv-row-main', style: { cursor: 'default' } }, h('span', { className: 'nv-row-text' }, h('span', { className: 'nv-skel', style: { width: '70%', height: 14 } }), h('span', { className: 'nv-skel', style: { width: '40%' } }))));
    var where = [p.building, p.floor].filter(Boolean).join(' ');
    return h('div', { className: cx('nv-row', p.isDestination && 'nv-row--dest', p.className), 'data-place': p.placeId },
      h('button', { type: 'button', className: 'nv-row-main', onClick: p.onOpen },
        h('span', { className: 'nv-row-text' },
          h('span', { className: 'nv-row-name' }, highlight(p.name, p.highlight)),
          (p.kindLabel || where) ? h('span', { className: 'nv-row-meta' }, p.kindLabel ? h(Badge, { label: p.kindLabel }) : null, where) : null),
        p.distanceM != null ? h('span', { className: 'nv-row-dist' }, meters(p.distanceM) + ' m') : null,
        p.isDestination ? h('span', { className: 'nv-badge', style: { background: 'var(--destination)', color: 'var(--destination-on)' } }, '行き先') : null),
      tagButtons(p.tags, p.onToggleTag, 'nv-row-tag'));
  }

  var KIND = { event: '企画', parking: '駐車場', facility: '設備' };
  function PlaceCard(p) {
    var eyebrow = [[p.building, p.floor].filter(Boolean).join(' '), KIND[p.kind]].filter(Boolean).join('・');
    if (p.loading) return h('section', { className: cx('nv-card', p.className), 'aria-busy': 'true', 'aria-label': '場所を読み込み中' },
      h('span', { className: 'nv-skel', style: { width: '30%' } }), h('span', { className: 'nv-skel', style: { width: '60%', height: 20 } }), h('span', { className: 'nv-skel', style: { width: '90%' } }));
    if (p.removed) return h('section', { className: cx('nv-card', p.className), 'aria-label': p.name },
      h('p', { className: 'nv-card-error' }, 'この場所は見られなくなりました'),
      h('div', { className: 'nv-card-row' }, h(Button, { variant: 'secondary', label: '閉じる', onPress: p.onClose, style: { flex: 1 } })));
    var desc = [p.description, p.hours].filter(Boolean).join('\n');
    return h('section', { className: cx('nv-card', p.className), 'aria-label': '選んだ場所', 'data-place': p.placeId },
      h('div', { className: 'nv-card-top' },
        h('div', { className: 'nv-card-text' },
          eyebrow ? h('p', { className: 'nv-card-eyebrow' }, eyebrow) : null,
          h('h2', { className: 'nv-card-title' }, p.name),
          desc ? h('p', { className: 'nv-card-desc' }, desc) : null),
        p.distanceM != null ? h('div', { className: 'nv-card-dist' }, h('p', { className: 'nv-num' }, meters(p.distanceM), h('small', null, 'm')), h('p', { className: 'nv-num-sub' }, '直線')) : null),
      h('div', { className: 'nv-card-row' }, tagButtons(p.tags || {}, p.onToggleTag, 'nv-tagbtn'),
        h('button', { type: 'button', className: 'nv-tagbtn', onClick: p.onOpenTags }, h(Icon, { name: 'plus', size: 14 }), 'タグ')),
      h('div', { className: 'nv-card-row' },
        h(Button, { variant: 'destination', size: 'lg', icon: 'navigation', label: 'ここへ向かう', onPress: p.onGo }),
        h(IconButton, { icon: 'close', label: '閉じる', onPress: p.onClose, style: { width: 48, height: 48, background: 'transparent', borderColor: 'var(--border-control)' } })));
  }

  function DestinationCard(p) {
    var arrived = p.state === 'arrived';
    var where = [p.building, p.floor].filter(Boolean).join(' ');
    var sec = p.updatedAt != null ? secondsSince(p.updatedAt) : null;
    var stale = sec != null && sec >= 30;
    var meta = arrived ? '建物の前に来ました' + (p.arriveWithinM ? '(行き先まで ' + p.arriveWithinM + ' m 以内)' : '')
      : (sec == null ? '' : (stale ? '更新が止まっています・' : '') + (sec < 60 ? sec + ' 秒前に更新' : Math.floor(sec / 60) + ' 分前に更新') + (p.accuracyM != null ? '・精度 ±' + meters(p.accuracyM) + ' m' : ''));
    return h('section', { className: cx('nv-card', 'nv-card--dest', p.className), 'aria-label': arrived ? '行き先に着いた' : '案内中', 'aria-live': 'polite' },
      h('div', { className: 'nv-card-top', style: { alignItems: 'center', gap: 14 } },
        h('span', { className: 'nv-dest-box' }, arrived ? h(Icon, { name: 'check', size: 30 })
          : h(Icon, { name: 'navigation', size: 30, filled: true, strokeWidth: 0.01, rotate: p.headingDeg || 0, label: p.directionLabel || dirWord(p.headingDeg || 0) })),
        h('div', { className: 'nv-card-text', style: { gap: 2 } },
          h('p', { className: 'nv-dest-eyebrow' }, (arrived ? '行き先に着きました' : '案内中') + (where ? '・' + where : '')),
          h('p', { className: 'nv-dest-name' }, p.placeName + (arrived ? '' : 'まで')),
          meta ? h('p', { className: cx('nv-dest-meta', stale && 'nv-dest-meta--stale') }, meta) : null),
        arrived ? null : h('div', { className: 'nv-card-dist' },
          h('p', { className: 'nv-num nv-num--lg' }, meters(p.remainingM), h('small', null, 'm')),
          p.directionLabel ? h('p', { className: 'nv-dest-dir' }, p.directionLabel) : null)),
      arrived && p.note ? h('p', { className: 'nv-dest-meta', style: { lineHeight: 1.6 } }, p.note) : null,
      h('div', { className: 'nv-actions' }, arrived
        ? [h(Button, { key: 'b', variant: 'secondary', label: '建物の中の地図', onPress: p.onBuildingMap }), h(Button, { key: 'f', variant: 'destination', label: '案内を終える', onPress: p.onFinish })]
        : [h(Button, { key: 'c', variant: 'secondary', icon: 'camera', label: 'カメラで見る', onPress: p.onCamera }), h(Button, { key: 's', variant: 'secondary', label: '案内をやめる', onPress: p.onStop })]));
  }

  function DestinationBar(p) {
    return h('div', { role: 'status', className: cx('nv-dbar', p.className) },
      h(Icon, { name: 'navigation', size: 26, filled: true, strokeWidth: 0.01, rotate: p.headingDeg || 0 }),
      h('span', { className: 'nv-dbar-text' }, p.placeName + 'まで ' + meters(p.remainingM) + ' m'),
      h(IconButton, { icon: 'close', label: '案内をやめる', plain: true, size: 18, onPress: p.onStop }));
  }

  function Sheet(p) {
    return h('section', { className: cx('nv-sheet', p.className), 'aria-label': p.title, style: p.style },
      h('span', { className: 'nv-sheet-grab', 'aria-hidden': 'true' }),
      h('div', { className: 'nv-sheet-head' },
        h('div', { className: 'nv-sheet-titles' }, h('h2', { className: 'nv-sheet-title' }, p.title), p.subtitle ? h('p', { className: 'nv-sheet-sub' }, p.subtitle) : null),
        p.onClose ? h(IconButton, { icon: 'close', label: '閉じる', onPress: p.onClose, size: 18, style: { background: 'transparent' } }) : null),
      p.children);
  }

  var CG_ARIA = ['混雑1 空いている', '混雑2', '混雑3', '混雑4', '混雑5 とても混んでいる'];
  function StampCongestionPicker(p) {
    return h('div', { className: cx('nv-group', p.className), role: 'group', 'aria-label': '混雑' },
      h('p', { className: 'nv-field-label' }, '混雑'),
      h('div', { className: 'nv-cg-grid' }, [1, 2, 3, 4, 5].map(function (n) {
        return h('button', {
          key: n, type: 'button', className: 'nv-cg', 'aria-label': CG_ARIA[n - 1], disabled: p.disabled,
          style: { background: 'var(--congestion-' + n + ')', color: 'var(--congestion-' + n + '-on)' },
          onClick: function () { if (p.onPick) p.onPick(n); }
        }, n);
      })),
      h('div', { className: 'nv-cg-ends', 'aria-hidden': 'true' }, h('span', null, '空いている'), h('span', null, 'とても混んでいる')));
  }

  function StampFeelingButton(p) {
    return h('button', { type: 'button', className: cx('nv-feel', p.className), disabled: p.disabled, onClick: p.onPress },
      h('span', { className: 'nv-feel-ic', 'aria-hidden': 'true' }, h(Icon, { name: p.feeling, size: 17 })), FEEL[p.feeling]);
  }

  function MyStampRow(p) {
    var s = stampInfo(p.kind);
    var when = agoLong(p.pressedAt) + (s.cg && p.expiresAt != null ? '・' + untilLong(p.expiresAt) : '');
    return h('div', { className: cx('nv-mystamp', p.retracting && 'nv-mystamp--busy', p.className), 'data-stamp': p.stampId },
      h('span', { className: 'nv-pill', style: { background: s.bg, color: s.fg } }, s.name),
      h('span', { className: 'nv-mystamp-when' }, when),
      h(Button, { variant: 'secondary', size: 'sm', label: '取り消す', onPress: p.onRetract, disabled: p.retracting, style: { height: 32, fontSize: 12 } }));
  }

  var TAG_NOTE = '作ると、この場所に付きます。タグはこの端末の中にだけ保存され、アプリのデータを消したり、別の端末を使ったりすると消えます。';
  function TagCreateField(p) {
    var v = p.value || '';
    return h('div', { className: cx('nv-group', p.className) },
      h('p', { className: 'nv-field-label' }, '新しいタグを作る'),
      h('div', { className: 'nv-inline' },
        h('input', {
          type: 'text', className: cx('nv-input', p.error && 'nv-input--error'), value: v, placeholder: 'タグの名前(例: 2日目に行く)', 'aria-label': '新しいタグの名前',
          'aria-invalid': p.error ? 'true' : undefined, onChange: function (e) { if (p.onChange) p.onChange(e.target.value); }
        }),
        h(Button, { variant: 'secondary', label: '作る', onPress: function () { if (p.onCreate) p.onCreate(v); }, style: { borderColor: 'var(--action-primary)', fontWeight: 800 } })),
      p.error ? h('p', { className: 'nv-error' }, p.error) : null,
      h('p', { className: 'nv-help' }, TAG_NOTE));
  }

  function BuildingFloorTabs(p) {
    var cur = p.current || (p.floors && p.floors[0] && p.floors[0].id);
    return h('div', { className: cx('nv-floors', p.className), role: 'group', 'aria-label': '階' }, (p.floors || []).map(function (f) {
      return h('button', {
        key: f.id, type: 'button', className: 'nv-floor', 'aria-pressed': f.id === cur ? 'true' : 'false',
        'aria-label': f.label + (f.count ? '・企画 ' + f.count + ' 件' : ''), onClick: function () { if (p.onChange) p.onChange(f.id); }
      }, f.label, f.count ? h('span', { className: 'nv-count', 'aria-hidden': 'true' }, f.count) : null);
    }));
  }

  function BuildingFloorPlan(p) {
    var plan = p.plan || {};
    return h('div', { className: cx('nv-plan', p.className) },
      h('svg', { role: 'img', 'aria-label': p.label || '見取り図', viewBox: plan.viewBox || '0 0 100 50', preserveAspectRatio: 'xMidYMid meet' },
        plan.d ? h('path', { className: 'nv-plan-shape', d: plan.d }) : null),
      (p.places || []).map(function (q) {
        if (q.kind && q.kind !== 'event') return h(FacilityMark, { key: q.id, kind: q.kind, x: q.x, y: q.y });
        return h('button', { key: q.id, type: 'button', className: 'nv-plan-pin', style: { left: q.x, top: q.y }, onClick: function () { if (p.onOpen) p.onOpen(q.id); } },
          h('span', { className: 'nv-plan-pin-label' }, q.name), h('span', { className: 'nv-plan-pin-stem', 'aria-hidden': 'true' }), h('span', { className: 'nv-plan-pin-dot', 'aria-hidden': 'true' }));
      }),
      p.note ? h('span', { className: 'nv-plan-note' }, p.note) : null);
  }

  function BuildingCameraOverlay(p) {
    var noHeading = p.heading == null;
    var status = noHeading ? '向いている方向が分かりません'
      : '現在地' + (p.accuracyM != null ? ' ±' + meters(p.accuracyM) + ' m' : '') + '・' + dirWord(p.heading) + 'を向いています';
    var deg = noHeading ? 0 : p.heading;
    return h('div', { className: cx('nv-cam', p.className), style: Object.assign({ width: p.width || 358, height: p.height || 420 }, p.style) },
      p.children,
      h('div', { className: cx('nv-cam-status', noHeading && 'nv-cam-status--off') }, h('i', { 'aria-hidden': 'true' }), status),
      (p.labels || []).map(function (l, i) {
        return h('span', {
          key: i, className: cx('nv-cam-label', l.behind && 'nv-cam-label--behind', l.isDestination && 'nv-cam-label--dest'),
          style: { left: l.x, top: l.y }
        }, l.name + ' ' + meters(l.distanceM) + ' m' + (l.behind ? '・建物の奥' : '') + (noHeading ? '(方向は目安)' : ''));
      }),
      p.frontBuilding && !noHeading ? h('span', { role: 'status', className: 'nv-cam-front', style: { top: p.frontY || '38%' } }, '正面: ' + p.frontBuilding) : null,
      noHeading ? h('span', { className: 'nv-cam-drag' }, '左右にドラッグして向きを合わせる') : h('span', { className: 'nv-cam-cross', 'aria-hidden': 'true' }),
      h('div', { className: 'nv-cam-mini', role: 'img', 'aria-label': 'ミニマップ(現在地と向いている方向)' },
        h('svg', { width: 76, height: 76, viewBox: '0 0 76 76' },
          noHeading ? null : h('path', { d: 'M38 38 L28.2 5.4 A34 34 0 0 1 47.8 5.4 Z', fill: 'var(--event)', opacity: 0.25, transform: 'rotate(' + deg + ' 38 38)' }),
          h('circle', { cx: 38, cy: 38, r: 4.5, fill: 'var(--facility)', stroke: 'var(--facility-on)', strokeWidth: 1.5 }))));
  }

  /* ---------------- 運営(PC) ---------------- */
  function DataTable(p) {
    var cols = p.columns || [];
    var rows = p.rows || [];
    return h('div', { className: cx('nv-table-wrap', p.className) },
      h('table', { className: 'nv-table' },
        h('thead', null, h('tr', null, cols.map(function (c) { return h('th', { key: c.key, scope: 'col' }, c.label); }), h('th', { scope: 'col' }, '操作'))),
        h('tbody', null, rows.length ? rows.map(function (r) {
          return h('tr', { key: r.id, 'aria-selected': r.id === p.selectedId ? 'true' : undefined },
            cols.map(function (c) { return h('td', { key: c.key }, c.render ? c.render(r) : r[c.key]); }),
            h('td', null, h(Button, { variant: 'secondary', size: 'sm', label: '編集', onPress: function () { if (p.onEdit) p.onEdit(r.id); }, style: { height: 32 } })));
        }) : h('tr', null, h('td', { colSpan: cols.length + 1, className: 'nv-table-empty' }, p.emptyText || 'まだ登録されていません')))));
  }

  function FormField(p) {
    var id = React.useMemo ? React.useMemo(function () { return 'nv-f-' + Math.random().toString(36).slice(2, 8); }, []) : 'nv-f';
    var common = {
      id: id, className: cx('nv-input', p.error && 'nv-input--error'), value: p.value, 'aria-invalid': p.error ? 'true' : undefined,
      onChange: function (e) { if (p.onChange) p.onChange(e.target.value); }
    };
    var ctl = p.kind === 'textarea' ? h('textarea', common)
      : p.kind === 'select' ? h('select', common, (p.options || []).map(function (o) { return h('option', { key: o, value: o }, o); }))
        : h('input', Object.assign({ type: 'text' }, common));
    return h('div', { className: cx('nv-form', p.className) },
      h('label', { htmlFor: id, className: 'nv-field-label' }, p.label), ctl,
      p.error ? h('p', { className: 'nv-error' }, p.error) : null,
      p.help ? h('p', { className: 'nv-help' }, p.help) : null);
  }

  function LocationPicker(p) {
    var v = p.value;
    return h('div', { className: cx('nv-form', p.className) },
      h('p', { className: 'nv-field-label' }, p.label || '位置(地図を押して置く)'),
      h('div', {
        className: 'nv-picker', role: 'application', 'aria-label': '位置を置く地図',
        onClick: function (e) {
          var r = e.currentTarget.getBoundingClientRect();
          if (p.onChange) p.onChange({ x: Math.round(((e.clientX - r.left) / r.width) * 1000) / 10, y: Math.round(((e.clientY - r.top) / r.height) * 1000) / 10 });
        }
      },
        h('svg', { viewBox: '0 0 100 60', preserveAspectRatio: 'none', 'aria-hidden': 'true' },
          (p.buildings || []).map(function (d, i) { return h('path', { key: i, className: 'nv-picker-bldg', d: d }); })),
        v ? h('span', { className: 'nv-mark nv-dot nv-dest-pin', style: { left: v.x + '%', top: v.y + '%' } }, h(Icon, { name: 'flag', size: 13, strokeWidth: 3 })) : null),
      h('p', { className: 'nv-help' }, v ? '置いた位置: 横 ' + v.x + '%・縦 ' + v.y + '%' : 'まだ置いていません'));
  }

  function BuildingShapePreview(p) {
    var s = p.shape;
    return h('div', { className: cx('nv-shape', p.className) },
      h('p', { className: 'nv-field-label' }, '建物の形(OpenStreetMap)'),
      h('div', { className: 'nv-shape-box' }, s ? h('svg', { viewBox: s.viewBox, preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': '建物の形' }, h('path', { className: 'nv-shape-path', d: s.d }))
        : h('p', { className: 'nv-shape-none' }, '形なし(カメラの正面に出ない)')),
      h(Button, { variant: 'secondary', size: 'sm', label: '形を読み込み直す', onPress: p.onReload, style: { height: 40 } }),
      h('p', { className: 'nv-attr' }, '© OpenStreetMap contributors'));
  }

  function DeleteConfirm(p) {
    return h('div', { role: 'alertdialog', 'aria-label': '削除の確認', className: cx('nv-confirm', p.className) },
      h('p', { className: 'nv-confirm-title' }, p.title),
      h('p', { className: 'nv-confirm-effects' }, p.effects),
      h('div', { className: 'nv-actions' },
        h(Button, { variant: 'danger', label: '削除する', onPress: p.onConfirm }),
        h(Button, { variant: 'secondary', label: 'やめる', onPress: p.onCancel })));
  }

  var api = {
    Button: Button, IconButton: IconButton, Chip: Chip, TabBar: TabBar, SearchField: SearchField, FilterBand: FilterBand, Banner: Banner,
    Toast: Toast, Badge: Badge, CheckRow: CheckRow, EmptyState: EmptyState, Icon: Icon,
    BuildingFlag: BuildingFlag, EventMark: EventMark, FacilityMark: FacilityMark, ParkingMark: ParkingMark, StampMark: StampMark,
    PositionMark: PositionMark, DestinationMark: DestinationMark,
    PlaceRow: PlaceRow, PlaceCard: PlaceCard, DestinationCard: DestinationCard, DestinationBar: DestinationBar, Sheet: Sheet,
    StampCongestionPicker: StampCongestionPicker, StampFeelingButton: StampFeelingButton, MyStampRow: MyStampRow, TagCreateField: TagCreateField,
    BuildingFloorTabs: BuildingFloorTabs, BuildingFloorPlan: BuildingFloorPlan, BuildingCameraOverlay: BuildingCameraOverlay,
    DataTable: DataTable, FormField: FormField, LocationPicker: LocationPicker, BuildingShapePreview: BuildingShapePreview, DeleteConfirm: DeleteConfirm
  };
  window.NAsVI = Object.assign(window.NAsVI || {}, api);
})();
