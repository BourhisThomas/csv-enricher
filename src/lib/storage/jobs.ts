import type {
  ApiUsage,
  CsvRow,
  EnrichmentConfig,
  EnrichmentResult,
  FieldMapping,
} from '@/lib/enricher/types'

export type JobStatus = 'running' | 'complete'

export interface StoredJob {
  id: string
  fileName: string
  createdAt: number
  updatedAt: number
  status: JobStatus
  rows: CsvRow[]
  headers: string[]
  mapping: FieldMapping
  config: EnrichmentConfig
  results: EnrichmentResult[]
  usage: ApiUsage | null
  unitCount: number
}

const DB_NAME = 'csv-enricher'
const DB_VERSION = 1
const STORE = 'jobs'

export const JOB_TTL_MS = 48 * 60 * 60 * 1000

let dbPromise: Promise<IDBDatabase> | null = null

function getDB(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable'))
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onerror = () => reject(req.error)
      req.onsuccess = () => resolve(req.result)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' })
        }
      }
    })
  }
  return dbPromise
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveJob(job: StoredJob): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(STORE, 'readwrite')
  await promisify(tx.objectStore(STORE).put(job))
}

export async function getJob(id: string): Promise<StoredJob | null> {
  const db = await getDB()
  const tx = db.transaction(STORE, 'readonly')
  const result = await promisify(tx.objectStore(STORE).get(id))
  return (result as StoredJob | undefined) ?? null
}

export async function listJobs(): Promise<StoredJob[]> {
  const db = await getDB()
  const tx = db.transaction(STORE, 'readonly')
  const all = (await promisify(tx.objectStore(STORE).getAll())) as StoredJob[]
  return all.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function deleteJob(id: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(STORE, 'readwrite')
  await promisify(tx.objectStore(STORE).delete(id))
}

export async function pruneOldJobs(maxAgeMs: number = JOB_TTL_MS): Promise<number> {
  const all = await listJobs()
  const cutoff = Date.now() - maxAgeMs
  const toDelete = all.filter(j => j.updatedAt < cutoff)
  for (const j of toDelete) await deleteJob(j.id)
  return toDelete.length
}

export function newJobId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `job-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function successCount(results: EnrichmentResult[]): number {
  return results.filter(r => r && !r.error && r.output !== undefined).length
}

export function errorCount(results: EnrichmentResult[]): number {
  return results.filter(r => r && r.error).length
}

export function findMissingIndexes(
  totalRows: number,
  results: EnrichmentResult[],
  includeErrors: boolean,
): number[] {
  const byIndex = new Map<number, EnrichmentResult>()
  for (const r of results) if (r) byIndex.set(r.row_index, r)
  const missing: number[] = []
  for (let i = 0; i < totalRows; i++) {
    const existing = byIndex.get(i)
    if (!existing) missing.push(i)
    else if (includeErrors && existing.error) missing.push(i)
  }
  return missing
}
