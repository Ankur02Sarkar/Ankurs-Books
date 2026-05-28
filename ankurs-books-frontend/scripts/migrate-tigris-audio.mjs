/**
 * migrate-tigris-audio.mjs
 *
 * ONE-TIME migration script.
 *
 * Moves all 1,023 Rig Veda MP3s in the `ankurs-books-assets` bucket from:
 *   audio/book-{NN}/hymn-{NNN}.mp3
 * to:
 *   audio/rigveda/book-{NN}/hymn-{NNN}.mp3
 *
 * Uses the Tigris SDK `move` operation (atomic rename within a bucket).
 * Runs 10 objects concurrently. A local migration log
 * (scripts/migration-log.json) tracks completed moves so the script
 * is safe to re-run if interrupted.
 *
 * Usage:
 *   bun run migrate-audio
 *   (credentials read from .env via --env-file=.env)
 */

import { list, move } from '@tigrisdata/storage'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LOG_PATH  = join(__dirname, 'migration-log.json')

const BUCKET     = process.env.TIGRIS_STORAGE_BUCKET ?? 'ankurs-books-assets'
const CDN_HOST   = `${BUCKET}.t3.tigrisfiles.io`
const BATCH_SIZE = 10

function loadLog() {
  if (existsSync(LOG_PATH)) return JSON.parse(readFileSync(LOG_PATH, 'utf8'))
  return { completed: [], failed: [] }
}

function saveLog(log) {
  writeFileSync(LOG_PATH, JSON.stringify(log, null, 2) + '\n', 'utf8')
}

function batches(arr, size) {
  const result = []
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size))
  return result
}

/** Derive new key from old key.
 *  "audio/book-01/hymn-001.mp3" → "audio/rigveda/book-01/hymn-001.mp3"
 */
function newKey(oldKey) {
  // Strip "audio/" prefix, prepend "audio/rigveda/"
  const relative = oldKey.slice('audio/'.length)   // "book-01/hymn-001.mp3"
  return `audio/rigveda/${relative}`               // "audio/rigveda/book-01/hymn-001.mp3"
}

/** List all objects under a given prefix (handles pagination). */
async function listAllUnderPrefix(prefix) {
  const keys = []
  let paginationToken = undefined
  do {
    const result = await list({ prefix, ...(paginationToken ? { paginationToken } : {}) })
    const items = result?.data?.items ?? []
    for (const item of items) {
      const key = item.id ?? item.name ?? item.key
      if (key?.endsWith('.mp3')) keys.push(key)
    }
    paginationToken = result?.data?.nextToken ?? result?.data?.continuationToken ?? undefined
  } while (paginationToken)
  return keys
}

async function main() {
  console.log('='.repeat(62))
  console.log('Tigris Audio Migration — Rig Veda path restructure')
  console.log(`Bucket  : ${BUCKET}`)
  console.log(`From    : audio/book-{NN}/hymn-{NNN}.mp3`)
  console.log(`To      : audio/rigveda/book-{NN}/hymn-{NNN}.mp3`)
  console.log(`Log     : ${LOG_PATH}`)
  console.log('='.repeat(62))

  if (!process.env.TIGRIS_STORAGE_ACCESS_KEY_ID) {
    console.error('\nERROR: TIGRIS_STORAGE_ACCESS_KEY_ID is not set.')
    process.exit(1)
  }

  // Load migration log (resume support)
  const log = loadLog()
  const completedSet = new Set(log.completed)
  console.log(`\nMigration log: ${completedSet.size} already completed`)

  // Discover all old keys (audio/book-01/ through audio/book-10/)
  console.log('\nListing existing audio/book-{NN}/ objects...')
  const oldKeys = []
  for (let bk = 1; bk <= 10; bk++) {
    const prefix = `audio/book-${String(bk).padStart(2, '0')}/`
    try {
      const keys = await listAllUnderPrefix(prefix)
      oldKeys.push(...keys)
      if (keys.length > 0) console.log(`  ${prefix}  → ${keys.length} files`)
    } catch (err) {
      console.warn(`  WARN listing ${prefix}: ${err.message}`)
    }
  }
  oldKeys.sort()
  console.log(`\nFound ${oldKeys.length} old MP3 keys total`)

  const toMigrate = oldKeys.filter((k) => !completedSet.has(k))
  console.log(`Already migrated : ${completedSet.size}`)
  console.log(`Remaining        : ${toMigrate.length}`)

  if (toMigrate.length === 0) {
    console.log('\n✓ All objects already migrated.')
    console.log('\nNext: bun run patch-json')
    return
  }

  console.log('\nStarting migration...\n')

  let moved  = 0
  let failed = 0
  const batchList = batches(toMigrate, BATCH_SIZE)

  for (let bi = 0; bi < batchList.length; bi++) {
    const batch = batchList[bi]
    const from  = bi * BATCH_SIZE + 1
    const to    = Math.min(from + BATCH_SIZE - 1, toMigrate.length)
    console.log(`Batch ${bi + 1}/${batchList.length}  (${from}–${to} of ${toMigrate.length})`)

    await Promise.all(batch.map(async (oldK) => {
      const nKey = newKey(oldK)
      try {
        const result = await move(oldK, nKey)
        if (result?.error) {
          throw new Error(result.error?.message ?? String(result.error))
        }
        if (!result?.data?.dest && !result?.data?.src) {
          throw new Error(`Unexpected move result: ${JSON.stringify(result)}`)
        }
        log.completed.push(oldK)
        completedSet.add(oldK)
        console.log(`  OK  ${oldK}`)
        console.log(`    → ${nKey}`)
        moved++
      } catch (err) {
        console.error(`  FAIL  ${oldK}: ${err.message}`)
        if (!log.failed.includes(oldK)) log.failed.push(oldK)
        failed++
      }
    }))

    saveLog(log)
    console.log(`  Log saved. (${moved} moved, ${failed} failed so far)\n`)
  }

  console.log('='.repeat(62))
  console.log('Migration complete.')
  console.log(`  Moved   : ${moved}`)
  console.log(`  Failed  : ${failed}`)
  console.log(`  Total   : ${oldKeys.length}`)
  console.log('='.repeat(62))

  if (failed > 0) {
    console.error(`\n${failed} objects failed. Re-run to retry.`)
    process.exit(1)
  }

  console.log('\nNew CDN base:')
  console.log(`  https://${CDN_HOST}/audio/rigveda/book-01/hymn-001.mp3`)
  console.log('\nNext: bun run patch-json')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
