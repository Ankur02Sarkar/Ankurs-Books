/**
 * upload-audio-to-tigris.mjs
 *
 * Uploads all MP3 audio files from public/audio/ to the Tigris
 * `ankurs-books-assets` bucket. The key path mirrors the local directory
 * structure relative to public/audio/, so files must be placed at:
 *   public/audio/rigveda/book-{NN}/hymn-{NNN}.mp3
 *
 * IDEMPOTENCY:
 *   - Maintains scripts/audio-manifest.json mapping each relative path to its
 *     Tigris URL, upload timestamp, and file size.
 *   - Files already in the manifest whose local mtime has NOT changed since
 *     the last upload are SKIPPED.
 *   - Files newer than their manifest entry are RE-UPLOADED.
 *   - Manifest is saved after EVERY batch so partial runs are resumable.
 *
 * Usage:
 *   bun run upload-audio
 *   (credentials read from .env via --env-file=.env)
 *
 * Tigris key pattern:
 *   audio/rigveda/book-{NN}/hymn-{NNN}.mp3
 *
 * Public CDN URL pattern:
 *   https://ankurs-books-assets.t3.tigrisfiles.io/audio/rigveda/book-01/hymn-001.mp3
 */

import { put } from '@tigrisdata/storage';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
} from 'fs';
import { join, relative, dirname, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname     = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT  = join(__dirname, '..');
const AUDIO_DIR     = join(PROJECT_ROOT, 'public', 'audio');
const MANIFEST_PATH = join(__dirname, 'audio-manifest.json');

const BUCKET     = process.env.TIGRIS_STORAGE_BUCKET ?? 'ankurs-books-assets';
const CDN_HOST   = `${BUCKET}.t3.tigrisfiles.io`;
const BATCH_SIZE = 10;

// ── Helpers ───────────────────────────────────────────────────────────────────

function contentTypeFor(ext) {
  return ext === '.json' ? 'application/json' : 'audio/mpeg';
}

/** Recursively collect all .mp3 files under a directory, sorted. */
function collectAudioFiles(dir) {
  if (!existsSync(dir)) return [];
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectAudioFiles(fullPath));
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.mp3') {
      results.push(fullPath);
    }
  }
  return results.sort();
}

function batches(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

function saveManifest(manifest) {
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

function tigrisKey(relPath) {
  // relPath: "rigveda/book-01/hymn-001.mp3"  →  key: "audio/rigveda/book-01/hymn-001.mp3"
  return `audio/${relPath.replace(/\\/g, '/')}`;
}

function cdnUrl(key) {
  return `https://${CDN_HOST}/${key}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(62));
  console.log('Tigris Audio Uploader — Ankur\'s Books');
  console.log(`Bucket   : ${BUCKET}`);
  console.log(`CDN host : ${CDN_HOST}`);
  console.log(`Audio dir: ${AUDIO_DIR}`);
  console.log(`Manifest : ${MANIFEST_PATH}`);
  console.log('='.repeat(62));

  // ── Validate credentials ──────────────────────────────────────
  if (!process.env.TIGRIS_STORAGE_ACCESS_KEY_ID) {
    console.error('\nERROR: TIGRIS_STORAGE_ACCESS_KEY_ID is not set.');
    console.error('Run with: node --env-file=.env scripts/upload-audio-to-tigris.mjs');
    process.exit(1);
  }

  // ── Check audio directory ─────────────────────────────────────
  if (!existsSync(AUDIO_DIR)) {
    console.error(`\nERROR: Audio directory not found: ${AUDIO_DIR}`);
    console.error('Expected: public/audio/rigveda/book-{NN}/hymn-{NNN}.mp3');
    console.error('Extract the Colab output first: unzip audio_output.zip -d public/audio/');
    process.exit(1);
  }

  // ── Load manifest ─────────────────────────────────────────────
  const manifest = existsSync(MANIFEST_PATH)
    ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
    : {};

  // ── Discover MP3 files ────────────────────────────────────────
  const allFiles  = collectAudioFiles(AUDIO_DIR);
  console.log(`\nFound ${allFiles.length} MP3 file(s) in public/audio/`);

  if (allFiles.length === 0) {
    console.log('Nothing to upload. Extract audio first.');
    return;
  }

  // ── Build work list ───────────────────────────────────────────
  const workItems = [];
  let skipped = 0;

  for (const fullPath of allFiles) {
    const relKey = relative(AUDIO_DIR, fullPath).replace(/\\/g, '/');
    const stat   = statSync(fullPath);
    const mtime  = stat.mtimeMs;
    const size   = stat.size;
    const entry  = manifest[relKey];

    if (entry) {
      const uploadedAt = new Date(entry.uploadedAt).getTime();
      if (mtime <= uploadedAt) { skipped++; continue; }
      workItems.push({ relKey, fullPath, key: tigrisKey(relKey), sizeBytes: size, isUpdate: true });
    } else {
      workItems.push({ relKey, fullPath, key: tigrisKey(relKey), sizeBytes: size, isUpdate: false });
    }
  }

  const newCount    = workItems.filter(w => !w.isUpdate).length;
  const updateCount = workItems.filter(w =>  w.isUpdate).length;
  console.log(`\n  Skipped (unchanged) : ${skipped}`);
  console.log(`  New uploads         : ${newCount}`);
  console.log(`  Re-uploads (updated): ${updateCount}`);
  console.log(`  Total to upload     : ${workItems.length}`);

  if (workItems.length === 0) {
    console.log('\nAll files are up to date. Nothing to upload.');
    console.log('To force re-upload, delete scripts/audio-manifest.json.');
    return;
  }

  // ── Upload in batches ─────────────────────────────────────────
  let uploaded = 0;
  let failed   = 0;
  const batchList = batches(workItems, BATCH_SIZE);

  for (let bi = 0; bi < batchList.length; bi++) {
    const batch = batchList[bi];
    const from  = bi * BATCH_SIZE + 1;
    const to    = Math.min(from + BATCH_SIZE - 1, workItems.length);
    console.log(`\nBatch ${bi + 1}/${batchList.length}  (${from}–${to} of ${workItems.length})`);

    await Promise.all(batch.map(async ({ relKey, fullPath, key, sizeBytes, isUpdate }) => {
      const tag = isUpdate ? 'UPDATE' : 'NEW   ';
      try {
        const buf    = readFileSync(fullPath);
        const result = await put(key, buf, {
          access:         'public',
          contentType:    'audio/mpeg',
          allowOverwrite: true,
        });

        if (result.error) {
          console.error(`  ERROR  [${tag}] ${relKey}: ${result.error?.message ?? result.error}`);
          failed++;
          return;
        }

        const url = cdnUrl(key);
        manifest[relKey] = { url, uploadedAt: new Date().toISOString(), sizeBytes };
        console.log(`  OK     [${tag}] ${relKey} (${Math.round(sizeBytes / 1024)} KB)`);
        uploaded++;
      } catch (err) {
        console.error(`  THROW  [${tag}] ${relKey}: ${err.message}`);
        failed++;
      }
    }));

    saveManifest(manifest);
    console.log(`  Manifest saved. (${uploaded} uploaded, ${failed} failed so far)`);
  }

  // ── Summary ───────────────────────────────────────────────────
  console.log('\n' + '='.repeat(62));
  console.log('Upload complete.');
  console.log(`  Uploaded : ${uploaded}  (${newCount} new, ${updateCount} updated)`);
  console.log(`  Skipped  : ${skipped}  (unchanged)`);
  console.log(`  Failed   : ${failed}`);
  console.log(`  Manifest : ${MANIFEST_PATH}`);
  console.log('='.repeat(62));
  console.log(`\nCDN base: https://${CDN_HOST}/audio/rigveda/`);
  console.log('Example : https://' + CDN_HOST + '/audio/rigveda/book-01/hymn-001.mp3');
  console.log('\nNext: bun run patch-json');

  if (failed > 0) {
    console.error('\nSome uploads failed. Re-run to retry failed files.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
