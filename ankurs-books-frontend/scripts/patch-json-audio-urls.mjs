/**
 * patch-json-audio-urls.mjs
 *
 * Reads each of the 5 Rig Veda JSON files from public/static/, injects an
 * `audio_url` field onto every hymn that has a confirmed upload in
 * scripts/audio-manifest.json, then:
 *   1. Writes the patched JSON back to public/static/ (in-place)
 *   2. Uploads the patched JSON files to Tigris under data/rigveda_modern-*.json
 *
 * Run AFTER upload-audio-to-tigris.mjs so the manifest is populated.
 *
 * Usage:
 *   bun run patch-json
 *   (credentials read from .env via --env-file=.env)
 *
 * Tigris key pattern for JSON:
 *   data/rigveda_modern-{range}.json
 *
 * Public CDN URL:
 *   https://ankurs-books-assets.t3.tigrisfiles.io/data/rigveda_modern-1-2.json
 *
 * Updated hymn schema:
 *   { title, url, content, audio_url? }
 *   audio_url is only added if the MP3 was confirmed uploaded.
 */

import { put } from '@tigrisdata/storage';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname    = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const STATIC_DIR   = join(PROJECT_ROOT, 'public', 'static');
const MANIFEST_PATH = join(__dirname, 'audio-manifest.json');

const BUCKET   = process.env.TIGRIS_STORAGE_BUCKET ?? 'ankurs-books-assets';
const CDN_BASE = process.env.NEXT_PUBLIC_CDN_BASE ?? `https://${BUCKET}.t3.tigrisfiles.io`;
const CDN_HOST = `${BUCKET}.t3.tigrisfiles.io`;

const SOURCE_FILES = [
  'rigveda_modern-1-2.json',
  'rigveda_modern-3-4.json',
  'rigveda_modern-5-6.json',
  'rigveda_modern-7-8.json',
  'rigveda_modern-9-10.json',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Given book number and hymn index, return the CDN audio URL.
 * Matches the naming convention from the Colab notebook:
 *   audio/book-{NN}/hymn-{NNN}.mp3
 */
function audioUrl(bookNum, hymnIdx) {
  const bookStr = String(bookNum).padStart(2, '0');
  const hymnStr = String(hymnIdx).padStart(3, '0');
  return `${CDN_BASE}/audio/book-${bookStr}/hymn-${hymnStr}.mp3`;
}

/**
 * The manifest key for a given book/hymn (matches what the upload script stores).
 * e.g. "book-01/hymn-001.mp3"
 */
function manifestKey(bookNum, hymnIdx) {
  const bookStr = String(bookNum).padStart(2, '0');
  const hymnStr = String(hymnIdx).padStart(3, '0');
  return `book-${bookStr}/hymn-${hymnStr}.mp3`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(62));
  console.log('Patch JSON + Upload to Tigris — Ankur\'s Books');
  console.log(`Bucket    : ${BUCKET}`);
  console.log(`CDN base  : ${CDN_BASE}`);
  console.log(`Static dir: ${STATIC_DIR}`);
  console.log(`Manifest  : ${MANIFEST_PATH}`);
  console.log('='.repeat(62));

  // ── Validate credentials ──────────────────────────────────────
  if (!process.env.TIGRIS_STORAGE_ACCESS_KEY_ID) {
    console.error('\nERROR: TIGRIS_STORAGE_ACCESS_KEY_ID is not set.');
    console.error('Run with: node --env-file=.env scripts/patch-json-audio-urls.mjs');
    process.exit(1);
  }

  // ── Load manifest ─────────────────────────────────────────────
  if (!existsSync(MANIFEST_PATH)) {
    console.error(`\nERROR: Manifest not found: ${MANIFEST_PATH}`);
    console.error('Run upload-audio first: bun run upload-audio');
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const manifestKeys = new Set(Object.keys(manifest));
  console.log(`\nManifest loaded — ${manifestKeys.size} uploaded files tracked`);

  // ── Process each JSON file ────────────────────────────────────
  let totalHymns    = 0;
  let patchedHymns  = 0;
  let missingAudio  = 0;
  const uploadedJsonFiles = [];

  for (const filename of SOURCE_FILES) {
    const filePath = join(STATIC_DIR, filename);

    if (!existsSync(filePath)) {
      console.error(`\n  SKIP: ${filename} not found at ${filePath}`);
      continue;
    }

    console.log(`\nProcessing: ${filename}`);
    const data = JSON.parse(readFileSync(filePath, 'utf8'));

    let filePatchCount = 0;
    let fileMissingCount = 0;

    for (const book of data.books) {
      // Extract book number from title: "Rig-Veda, Book 1" → 1
      const match = book.title.match(/Book\s+(\d+)/);
      const bookNum = match ? parseInt(match[1], 10) : null;

      if (!bookNum) {
        console.warn(`  WARN: Could not parse book number from "${book.title}"`);
        continue;
      }

      for (let hymnIdx = 1; hymnIdx <= book.hymns.length; hymnIdx++) {
        const hymn = book.hymns[hymnIdx - 1];
        const mKey = manifestKey(bookNum, hymnIdx);
        totalHymns++;

        if (manifestKeys.has(mKey)) {
          hymn.audio_url = audioUrl(bookNum, hymnIdx);
          filePatchCount++;
          patchedHymns++;
        } else {
          // Remove stale audio_url if present from a previous run
          delete hymn.audio_url;
          fileMissingCount++;
          missingAudio++;
        }
      }
    }

    // Write patched JSON back to public/static/
    const jsonStr = JSON.stringify(data, null, 2) + '\n';
    writeFileSync(filePath, jsonStr, 'utf8');
    console.log(`  Patched: ${filePatchCount} hymns with audio_url`);
    if (fileMissingCount > 0) {
      console.log(`  Missing: ${fileMissingCount} hymns have no audio yet`);
    }
    console.log(`  Saved  : ${filePath}`);

    uploadedJsonFiles.push({ filename, filePath, jsonStr });
  }

  console.log('\n' + '-'.repeat(62));
  console.log(`Patching summary:`);
  console.log(`  Total hymns    : ${totalHymns}`);
  console.log(`  Patched        : ${patchedHymns} (audio_url added)`);
  console.log(`  Missing audio  : ${missingAudio} (no MP3 uploaded yet)`);

  // ── Upload patched JSON files to Tigris ───────────────────────
  console.log('\n' + '-'.repeat(62));
  console.log('Uploading patched JSON files to Tigris...');

  let jsonUploaded = 0;
  let jsonFailed   = 0;

  for (const { filename, jsonStr } of uploadedJsonFiles) {
    const key = `data/${filename}`;
    const url = `https://${CDN_HOST}/${key}`;

    try {
      const buf    = Buffer.from(jsonStr, 'utf8');
      const result = await put(key, buf, {
        access:         'public',
        contentType:    'application/json',
        allowOverwrite: true,
      });

      if (result.error) {
        console.error(`  ERROR  ${filename}: ${result.error?.message ?? result.error}`);
        jsonFailed++;
        continue;
      }

      console.log(`  OK     ${filename} → ${url}`);
      jsonUploaded++;
    } catch (err) {
      console.error(`  THROW  ${filename}: ${err.message}`);
      jsonFailed++;
    }
  }

  // ── Final summary ─────────────────────────────────────────────
  console.log('\n' + '='.repeat(62));
  console.log('Done.');
  console.log(`  JSON files uploaded : ${jsonUploaded}/${uploadedJsonFiles.length}`);
  console.log(`  Hymns patched       : ${patchedHymns}/${totalHymns}`);
  console.log(`  Missing audio       : ${missingAudio} hymns`);
  console.log('='.repeat(62));
  console.log('\nCDN data URLs:');
  for (const { filename } of uploadedJsonFiles) {
    console.log(`  https://${CDN_HOST}/data/${filename}`);
  }
  console.log('\nNext: Phase 3 — build the frontend (bun run dev)');

  if (jsonFailed > 0) {
    console.error('\nSome JSON uploads failed. Re-run to retry.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
