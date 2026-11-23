import { object, resolveRef, type OpenApiSpec } from './openapi';

export interface Violation { path: string; message: string }

const supported = new Set([
  'type', 'properties', 'required', 'items', 'enum', 'allOf', 'oneOf', 'nullable',
  'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems',
  'minProperties', 'maxProperties', 'format', 'additionalProperties',
  'description', 'title', 'example', 'examples', 'default', 'deprecated', 'readOnly', 'writeOnly',
]);

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => equal(item, b[i]));
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object'
    && !Array.isArray(a) && !Array.isArray(b)) {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    return Object.keys(left).length === Object.keys(right).length
      && Object.keys(left).every(key => Object.hasOwn(right, key) && equal(left[key], right[key]));
  }
  return false;
}

// 未対応の制約は失敗にせず、ここに集めて件数に出す(検証できなかったもの)。
export type Unchecked = Set<string>;

function matchesType(value: unknown, type: unknown, unchecked?: Unchecked): boolean {
  switch (type) {
    case 'null': return value === null;
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array': return Array.isArray(value);
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'string': return typeof value === 'string';
    case 'boolean': return typeof value === 'boolean';
    default: unchecked?.add(`type: ${String(type)}`); return true;
  }
}

// UTC とオフセット付きの RFC 3339。Date.parse だけでは通る 2 月 30 日も拒否する。
function dateTime(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, y, m, d, h, minute, second, offsetHour = '0', offsetMinute = '0'] = match;
  const year = Number(y);
  const month = Number(m);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && Number(d) >= 1 && Number(d) <= days[month - 1]
    && Number(h) <= 23 && Number(minute) <= 59 && Number(second) <= 59
    && Number(offsetHour) <= 23 && Number(offsetMinute) <= 59;
}

export function validateSchema(spec: OpenApiSpec, schema: unknown, value: unknown, path = '$', depth = 0, unchecked?: Unchecked): Violation[] {
  if (depth > 64) throw new Error('スキーマの参照が深すぎます');
  schema = resolveRef(spec, schema);
  if (schema === true) return [];
  if (schema === false) return [{ path, message: '許可されていない値です' }];
  const rule = object(schema, 'schema');
  for (const key of Object.keys(rule)) {
    if (!supported.has(key) && !key.startsWith('x-')) unchecked?.add(key);
  }
  const errors: Violation[] = [];
  const add = (message: string): void => { errors.push({ path, message }); };
  const validate = (child: unknown, item: unknown, childPath = path): Violation[] => validateSchema(spec, child, item, childPath, depth + 1, unchecked);
  if (rule.allOf !== undefined) {
    if (!Array.isArray(rule.allOf)) throw new Error('allOf は配列で指定してください');
    for (const child of rule.allOf) errors.push(...validate(child, value));
  }
  if (rule.oneOf !== undefined) {
    if (!Array.isArray(rule.oneOf)) throw new Error('oneOf は配列で指定してください');
    const count = rule.oneOf.filter(child => validate(child, value).length === 0).length;
    if (count !== 1) add(`oneOf の一致数は 1 が必要です (実際: ${count})`);
  }
  if (rule.enum !== undefined) {
    if (!Array.isArray(rule.enum)) throw new Error('enum は配列で指定してください');
    if (!rule.enum.some(item => equal(item, value))) add('enum に含まれていません');
  }
  if (value === null && rule.nullable === true) return errors;
  if (rule.type !== undefined) {
    const types = Array.isArray(rule.type) ? rule.type : [rule.type];
    if (!types.some(type => matchesType(value, type, unchecked))) {
      add(`型が一致しません (期待: ${types.join(' | ')})`);
      return errors;
    }
  }
  const limit = (name: string, actual: number, lower: boolean): void => {
    const bound = rule[name];
    if (bound === undefined) return;
    if (typeof bound !== 'number') throw new Error(`${name} は数値で指定してください`);
    if (lower ? actual < bound : actual > bound) add(`${name}: ${bound} に違反しています (実際: ${actual})`);
  };
  if (typeof value === 'number') {
    limit('minimum', value, true);
    limit('maximum', value, false);
  }
  if (typeof value === 'string') {
    limit('minLength', [...value].length, true);
    limit('maxLength', [...value].length, false);
    if (rule.format !== undefined) {
      if (rule.format !== 'date-time') unchecked?.add(`format: ${String(rule.format)}`);
      else if (!dateTime(value)) add('date-time 形式ではありません');
    }
  }
  if (Array.isArray(value)) {
    limit('minItems', value.length, true);
    limit('maxItems', value.length, false);
    if (rule.items !== undefined) value.forEach((item, i) => errors.push(...validate(rule.items, item, `${path}[${i}]`)));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const data = object(value, path);
    const properties = rule.properties === undefined ? {} : object(rule.properties, 'properties');
    limit('minProperties', Object.keys(data).length, true);
    limit('maxProperties', Object.keys(data).length, false);
    if (rule.required !== undefined) {
      if (!Array.isArray(rule.required) || rule.required.some(key => typeof key !== 'string')) throw new Error('required は文字列の配列で指定してください');
      for (const key of rule.required as string[]) {
        if (!Object.hasOwn(data, key)) errors.push({ path: `${path}.${key}`, message: '必須項目がありません' });
      }
    }
    for (const [key, item] of Object.entries(data)) {
      if (Object.hasOwn(properties, key)) errors.push(...validate(properties[key], item, `${path}.${key}`));
      else if (rule.additionalProperties === false) errors.push({ path: `${path}.${key}`, message: '未定義の項目です' });
      else if (rule.additionalProperties !== undefined && rule.additionalProperties !== true) {
        errors.push(...validate(rule.additionalProperties, item, `${path}.${key}`));
      }
    }
  }
  return errors;
}
