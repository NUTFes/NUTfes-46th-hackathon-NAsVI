export function prepare(db: D1Database, sql: string, values: unknown[] = []): D1PreparedStatement {
  return db.prepare(sql).bind(...values);
}

export async function all<T>(db: D1Database, sql: string, values: unknown[] = []): Promise<T[]> {
  return (await prepare(db, sql, values).all<T>()).results;
}

export async function first<T>(db: D1Database, sql: string, values: unknown[] = []): Promise<T | null> {
  return prepare(db, sql, values).first<T>();
}

export async function run(db: D1Database, sql: string, values: unknown[] = []): Promise<D1Result> {
  return prepare(db, sql, values).run();
}
