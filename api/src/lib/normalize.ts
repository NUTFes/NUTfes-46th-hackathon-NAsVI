export function normalize(name: string): string {
  return name.normalize('NFKC').toLowerCase();
}

/** Use with LIKE ? ESCAPE '\\' so literal %, _ and \\ remain literal. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
