import type Dexie from 'dexie'

const cache = new WeakMap<Dexie, Map<string, ReadonlySet<string>>>()

/** 암호문 밖에 남기는 칸: 기본키 + 모든 색인 칸(복합이면 각 칸) + updated_at + deleted */
export function plainFieldsOf(db: Dexie, table: string): ReadonlySet<string> {
  let m = cache.get(db)
  if (!m) { m = new Map(); cache.set(db, m) }
  const hit = m.get(table)
  if (hit) return hit
  const schema = db.table(table).schema
  const out = new Set<string>(['updated_at', 'deleted'])
  const add = (kp: string | string[] | undefined | null) => {
    if (kp == null) return
    for (const k of Array.isArray(kp) ? kp : [kp]) if (k) out.add(k)
  }
  add(schema.primKey.keyPath)
  for (const ix of schema.indexes) add(ix.keyPath)
  m.set(table, out)
  return out
}
