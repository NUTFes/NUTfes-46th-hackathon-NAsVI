type Mapping = Record<string, unknown>;

// OpenAPI が使うブロック YAML の範囲だけを扱う。未対応の構文は黙って読み飛ばさない。
function delimiters(text: string, delimiter: string): number[] {
  const positions: number[] = [];
  let quote = '';
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (quote === '"' && char === '\\') { i++; continue; }
      if (char === quote) {
        if (quote === "'" && text[i + 1] === "'") { i++; continue; }
        quote = '';
      }
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '[' || char === '{') depth++;
    else if (char === ']' || char === '}') depth--;
    else if (depth === 0 && char === delimiter) positions.push(i);
    if (depth < 0) throw new Error(`YAML: 括弧が対応していません: ${text}`);
  }
  if (quote || depth !== 0) throw new Error(`YAML: クォートか括弧が閉じていません: ${text}`);
  return positions;
}

function uncomment(text: string): string {
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (quote === '"' && char === '\\') { i++; continue; }
      if (char === quote) {
        if (quote === "'" && text[i + 1] === "'") { i++; continue; }
        quote = '';
      }
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '#' && (i === 0 || /\s/.test(text[i - 1]))) return text.slice(0, i).trimEnd();
  }
  return text.trimEnd();
}

function mappingColon(text: string): number | undefined {
  return delimiters(text, ':').find(i => i + 1 === text.length || /\s/.test(text[i + 1]));
}

function assign(target: Mapping, key: string, value: unknown): void {
  if (Object.hasOwn(target, key)) throw new Error(`YAML: キーが重複しています: ${key}`);
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

function keyOf(text: string): string {
  const key = scalar(text.trim());
  if (typeof key !== 'string' && typeof key !== 'number') throw new Error(`YAML: 不正なキー: ${text}`);
  return String(key);
}

function scalar(text: string): unknown {
  if (text.startsWith('[') || text.startsWith('{')) {
    delimiters(text, ',');
    const array = text[0] === '[';
    if (!text.endsWith(array ? ']' : '}')) throw new Error(`YAML: 不正なフロー形式: ${text}`);
    const inner = text.slice(1, -1).trim();
    const indices = [-1, ...delimiters(inner, ','), inner.length];
    const parts = indices.slice(1).map((end, i) => inner.slice(indices[i] + 1, end).trim()).filter(Boolean);
    if (array) return parts.map(scalar);
    const result: Mapping = {};
    for (const part of parts) {
      const colon = delimiters(part, ':')[0];
      if (colon === undefined) throw new Error(`YAML: マップにコロンがありません: ${part}`);
      assign(result, keyOf(part.slice(0, colon)), scalar(part.slice(colon + 1).trim()));
    }
    return result;
  }
  if (text.startsWith('"')) return JSON.parse(text) as unknown;
  if (text.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(text)) throw new Error(`YAML: 不正なクォート: ${text}`);
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (/^(?:null|~)$/i.test(text) || text === '') return null;
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return Number(text);
  if (/^[&*!>|%@`]/.test(text)) throw new Error(`YAML: 未対応の構文: ${text}`);
  return text;
}

export function parseYaml(source: string): unknown {
  const lines = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  let index = 0;
  const indent = (line: string): number => {
    if (/^ *\t/.test(line)) throw new Error('YAML: インデントにタブは使えません');
    return line.length - line.trimStart().length;
  };
  const skip = (): void => {
    while (index < lines.length && !uncomment(lines[index]).trim()) index++;
  };
  const value = (text: string, parentIndent: number): unknown => {
    if (/^[>|][+-]?$/.test(text)) {
      const block: string[] = [];
      let blockIndent: number | undefined;
      while (index < lines.length) {
        const line = lines[index];
        if (line.trim() && indent(line) <= parentIndent) break;
        if (line.trim() && blockIndent === undefined) blockIndent = indent(line);
        if (line.trim() && indent(line) < (blockIndent ?? 0)) throw new Error('YAML: ブロックスカラのインデントが不正です');
        block.push(line.trim() ? line.slice(blockIndent) : '');
        index++;
      }
      let result = '';
      for (let i = 0; i < block.length; i++) {
        result += block[i];
        const fold = text[0] === '>' && block[i] !== '' && block[i + 1] !== undefined && block[i + 1] !== ''
          && !/^\s/.test(block[i]) && !/^\s/.test(block[i + 1]);
        result += fold ? ' ' : '\n';
      }
      if (text.endsWith('-')) return result.replace(/\n+$/, '');
      if (text.endsWith('+')) return result;
      return result ? result.replace(/\n+$/, '\n') : '';
    }
    if (text) return scalar(text);
    skip();
    return index < lines.length && indent(lines[index]) > parentIndent ? block(indent(lines[index])) : null;
  };
  const entry = (target: Mapping, text: string, level: number): void => {
    const colon = mappingColon(text);
    if (colon === undefined) throw new Error(`YAML: ${index} 行目のマップが不正です`);
    assign(target, keyOf(text.slice(0, colon)), value(text.slice(colon + 1).trim(), level));
  };
  const block = (level: number): unknown => {
    skip();
    const isList = /^-(?:\s|$)/.test(lines[index].slice(level));
    const result: unknown[] | Mapping = isList ? [] : {};
    while (index < lines.length) {
      skip();
      if (index >= lines.length || indent(lines[index]) < level) break;
      if (indent(lines[index]) !== level) throw new Error(`YAML: ${index + 1} 行目のインデントが不正です`);
      const text = uncomment(lines[index].slice(level));
      index++;
      if (Array.isArray(result)) {
        if (!/^-(?:\s|$)/.test(text)) throw new Error('YAML: リストとマップが混在しています');
        const rest = text.slice(1).trimStart();
        if (mappingColon(rest) !== undefined && !/^[{["']/.test(rest)) {
          const item: Mapping = {};
          const itemLevel = level + text.indexOf(rest);
          entry(item, rest, itemLevel);
          skip();
          while (index < lines.length && indent(lines[index]) > level) {
            if (indent(lines[index]) !== itemLevel) throw new Error('YAML: リスト内マップのインデントが不正です');
            const next = uncomment(lines[index].slice(itemLevel));
            index++;
            entry(item, next, itemLevel);
            skip();
          }
          result.push(item);
        } else result.push(value(rest, level));
      } else {
        if (/^-(?:\s|$)/.test(text)) throw new Error('YAML: マップとリストが混在しています');
        entry(result, text, level);
      }
    }
    return result;
  };
  skip();
  if (index >= lines.length) return null;
  return block(indent(lines[index]));
}
