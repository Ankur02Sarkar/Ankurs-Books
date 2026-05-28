/**
 * patch-json-audio-urls.mjs
 *
 * Fetches each of the 5 Rig Veda JSON files from the Tigris CDN, injects an
 * `audio_url` field onto every hymn whose MP3 exists in the bucket under
 * audio/rigveda/book-{NN}/hymn-{NNN}.mp3, then re-uploads the patched JSON
 * back to Tigris under data/rigveda_modern-*.json.
 *
 * NOTE: Reads source JSON from the CDN (not local disk) so this script works
 * even when public/static/ has been deleted.
 *
 * Audio URL pattern:
 *   https://ankurs-books-assets.t3.tigrisfiles.io/audio/rigveda/book-{NN}/hymn-{NNN}.mp3
 *
 * Data URL pattern (unchanged):
 *   https://ankurs-books-assets.t3.tigrisfiles.io/data/rigveda_modern-{range}.json
 *
 * Hymn presence is checked against scripts/audio-manifest.json if it exists,
 * otherwise falls back to a HEAD request for each MP3 (slower but always correct).
 *
 * Usage:
 *   bun run patch-json
 *   (credentials read from .env via --env-file=.env)
 */

import { put } from '@tigrisdata/storage'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname     = dirname(fileURLToPath(import.meta.url))
const MANIFEST_PATH = join(__dirname, 'audio-manifest.json')

const BUCKET   = process.env.TIGRIS_STORAGE_BUCKET ?? 'ankurs-books-assets'
const CDN_BASE = process.env.NEXT_PUBLIC_CDN_BASE ?? `https://${BUCKET}.t3.tigrisfiles.io`
const CDN_HOST = `${BUCKET}.t3.tigrisfiles.io`

const SOURCE_FILES = [
  'rigveda_modern-1-2.json',
  'rigveda_modern-3-4.json',
  'rigveda_modern-5-6.json',
  'rigveda_modern-7-8.json',
  'rigveda_modern-9-10.json',
]

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * CDN audio URL — now includes rigveda/ namespace.
 *   audio/rigveda/book-{NN}/hymn-{NNN}.mp3
 */
function audioUrl(bookNum, hymnIdx) {
  const bookStr = String(bookNum).padStart(2, '0')
  const hymnStr = String(hymnIdx).padStart(3, '0')
  return `${CDN_BASE}/audio/rigveda/book-${bookStr}/hymn-${hymnStr}.mp3`
}

/**
 * Manifest key — matches what upload-audio-to-tigris.mjs stores
 * (relative path from public/audio/).
 *   rigveda/book-{NN}/hymn-{NNN}.mp3
 */
function manifestKey(bookNum, hymnIdx) {
  const bookStr = String(bookNum).padStart(2, '0')
  const hymnStr = String(hymnIdx).padStart(3, '0')
  return `rigveda/book-${bookStr}/hymn-${hymnStr}.mp3`
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(62))
  console.log("Patch JSON + Upload to Tigris — Ankur's Books")
  console.log(`Bucket    : ${BUCKET}`)
  console.log(`CDN base  : ${CDN_BASE}`)
  console.log(`Source    : ${CDN_BASE}/data/<file>.json  (fetched from CDN)`)
  console.log(`Manifest  : ${MANIFEST_PATH}`)
  console.log('='.repeat(62))

  if (!process.env.TIGRIS_STORAGE_ACCESS_KEY_ID) {
    console.error('\nERROR: TIGRIS_STORAGE_ACCESS_KEY_ID is not set.')
    console.error('Run with: node --env-file=.env scripts/patch-json-audio-urls.mjs')
    process.exit(1)
  }

  // ── Load manifest (preferred — fast, no network per hymn) ─────
  // Only use manifest if it has entries; an empty manifest means
  // the paths changed (migration) and we must fall back to HEAD checks.
  let manifestKeys = null
  if (existsSync(MANIFEST_PATH)) {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
    const size = Object.keys(manifest).length
    if (size > 0) {
      manifestKeys = new Set(Object.keys(manifest))
      console.log(`\nManifest loaded — ${size} uploaded files tracked`)
    } else {
      console.log('\nManifest is empty — falling back to HEAD requests to verify each MP3')
    }
  } else {
    console.log('\nNo manifest found — will check each MP3 via HEAD request (slow)')
  }

  // ── Process each JSON file ────────────────────────────────────
  let totalHymns   = 0
  let patchedHymns = 0
  let missingAudio = 0
  const uploadedJsonFiles = []

  for (const filename of SOURCE_FILES) {
    const cdnUrl = `${CDN_BASE}/data/${filename}`
    console.log(`\nFetching: ${cdnUrl}`)

    let data
    try {
      const res = await fetch(cdnUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      data = await res.json()
    } catch (err) {
      console.error(`  ERROR fetching ${filename}: ${err.message}`)
      console.error('  Skipping this file.')
      continue
    }

    let filePatchCount   = 0
    let fileMissingCount = 0

    for (const book of data.books) {
      const match   = book.title.match(/Book\s+(\d+)/)
      const bookNum = match ? parseInt(match[1], 10) : null
      if (!bookNum) {
        console.warn(`  WARN: Could not parse book number from "${book.title}"`)
        continue
      }

      for (let hymnIdx = 1; hymnIdx <= book.hymns.length; hymnIdx++) {
        const hymn = book.hymns[hymnIdx - 1]
        totalHymns++

        let hasAudio = false

        if (manifestKeys) {
          // Fast path: check manifest
          hasAudio = manifestKeys.has(manifestKey(bookNum, hymnIdx))
        } else {
          // Slow path: HEAD request
          try {
            const headRes = await fetch(audioUrl(bookNum, hymnIdx), { method: 'HEAD' })
            hasAudio = headRes.ok
          } catch {
            hasAudio = false
          }
        }

        if (hasAudio) {
          hymn.audio_url = audioUrl(bookNum, hymnIdx)
          filePatchCount++
          patchedHymns++
        } else {
          delete hymn.audio_url
          fileMissingCount++
          missingAudio++
        }
      }
    }

    const jsonStr = JSON.stringify(data, null, 2) + '\n'
    console.log(`  Patched: ${filePatchCount} hymns with audio_url`)
    if (fileMissingCount > 0) {
      console.log(`  Missing: ${fileMissingCount} hymns have no audio yet`)
    }

    uploadedJsonFiles.push({ filename, jsonStr })
  }

  console.log('\n' + '-'.repeat(62))
  console.log('Patching summary:')
  console.log(`  Total hymns   : ${totalHymns}`)
  console.log(`  Patched       : ${patchedHymns} (audio_url added)`)
  console.log(`  Missing audio : ${missingAudio} (no MP3 uploaded yet)`)

  // ── Upload patched JSON files to Tigris ───────────────────────
  console.log('\n' + '-'.repeat(62))
  console.log('Uploading patched JSON files to Tigris...')

  let jsonUploaded = 0
  let jsonFailed   = 0

  for (const { filename, jsonStr } of uploadedJsonFiles) {
    const key = `data/${filename}`
    const url = `https://${CDN_HOST}/${key}`

    try {
      const buf    = Buffer.from(jsonStr, 'utf8')
      const result = await put(key, buf, {
        access:         'public',
        contentType:    'application/json',
        allowOverwrite: true,
      })

      if (result.error) {
        console.error(`  ERROR  ${filename}: ${result.error?.message ?? result.error}`)
        jsonFailed++
        continue
      }

      console.log(`  OK     ${filename} → ${url}`)
      jsonUploaded++
    } catch (err) {
      console.error(`  THROW  ${filename}: ${err.message}`)
      jsonFailed++
    }
  }

  // ── Final summary ─────────────────────────────────────────────
  console.log('\n' + '='.repeat(62))
  console.log('Done.')
  console.log(`  JSON files uploaded : ${jsonUploaded}/${uploadedJsonFiles.length}`)
  console.log(`  Hymns patched       : ${patchedHymns}/${totalHymns}`)
  console.log(`  Missing audio       : ${missingAudio} hymns`)
  console.log('='.repeat(62))
  console.log('\nCDN data URLs:')
  for (const { filename } of uploadedJsonFiles) {
    console.log(`  https://${CDN_HOST}/data/${filename}`)
  }

  if (jsonFailed > 0) {
    console.error('\nSome JSON uploads failed. Re-run to retry.')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
