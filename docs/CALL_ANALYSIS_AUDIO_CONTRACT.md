# Phase 38 — Audio Playback & Timeline Contract (DRAFT)

> Status: **§A–C LOCKED + SHIPPED in 38c (single-segment player), preview-verified 2026-06-22 (PR #39). §D (multi-segment assembly + iOS decode) remains PENDING an iPhone device gate.** Dated 2026-06-20; updated 2026-06-22.
> 38c built the single-segment player against §A–C (server-proxy + Range + Content-Type). The synced transcript (38d) + the multi-segment playback path consume §D — build those AFTER Felix's real ≥10-min iPhone recording signs off §D1–D4.

## Why this exists
The objective pipeline (chunks → Deepgram transcript → score) is built and persisted but never surfaced. Playback is the missing primitive. Audio is captured in ~10-min **segments** of 5s **chunks** with a 2s rotation **overlap**; the contract defines how those reassemble into one seekable timeline and how word/evidence times map onto it.

## A. LOCKED — confirmed against live data/code (2026-06-20)
1. **Blob is private.** An unauthenticated GET of a real `recording_chunks.blob_url` returns **403 "Forbidden"** (probed on `8eb5e643`). → The `/audio` route **always proxies bytes server-side** with the Blob token and **never hands a `blob_url` to the browser**. No client-side `<audio src=blob_url>`. (The `src/lib/transcription/blobFetcher.ts` "public GET" comment is stale/wrong — do not copy it.)
2. **No privacy hole** to close — the store correctly rejects anonymous reads.
3. **No `content_type` column** on `recording_chunks` (cols: id, recording_id, chunk_index, blob_pathname, blob_url, size_bytes, duration_ms, status, uploaded_at, created_at, segment_index). → Serve `Content-Type` from the **blob's own response header** (server-proxy passes it through) or infer from `blob_pathname`/magic bytes. Do **not** assume a stored type.
4. **`recording_chunks.duration_ms` is null** in practice → per-segment duration comes from **`transcript_segments.duration_ms`** (written from Deepgram `metadata.duration*1000`). Null for failed/empty segments → drives the honest "audio incomplete" state.
5. **Chunk reads must be ordered + gap-aware.** `getChunkRefsForRecording` silently filters to `status='uploaded'` and omits `blob_pathname`/`size_bytes` → a **new chunk-read helper** returns `chunk_index, segment_index, blob_url, size_bytes, status` in order; a non-dense `chunk_index` sequence ⇒ honest "audio incomplete," never a corrupt stream.

## B. LOCKED — design decisions
6. **Timeline = audio-time, not wall-clock.** Collapse inter-segment gaps; render them as **non-seekable markers**. Never pad with silence (implies audio that doesn't exist).
7. **Overlap = trim** the 2s rotation overlap for a clean timeline (seam-aligned), rather than an audible 2s repeat each ~10 min. (Empirical seam alignment confirmed in the device gate.)
8. **Missing/failed chunk = honest degrade** ("audio unavailable / incomplete"), not a best-effort corrupt concat.
9. **Remux cache key (if server-remux wins) must be collision-safe:** `recordingId + chunkCount + total sizeBytes` (or a content hash) — **never `chunkCount` alone** (a retry overwrites a chunk at the same index/count with different bytes → stale audio).

## C. LOCKED — word/evidence time re-basing
- Deepgram word `start`/`end` are **SECONDS**, per-segment-relative (`deepgram.ts`).
- Canonical per-segment duration = `transcript_segments.duration_ms / 1000`. **Note:** Deepgram's `metadata.duration` measures the bytes it received, which **still include the 2s overlap**.
- For segment `i` (0-based), with `OVERLAP = 2s` trimmed at the *start* of every segment after the first:
  - `offset_i = Σ_{j<i}(duration_j) − (i × OVERLAP)`
  - `word_global = max(0, word_local − (i>0 ? OVERLAP : 0)) + offset_i`
- **Worked example** (durations are the Deepgram overlap-inclusive seconds):
  - seg0 dur=600, seg1 dur=600, seg2 dur=300; OVERLAP=2
  - `offset_0 = 0` · `offset_1 = 600 − 2 = 598` · `offset_2 = (600+600) − 4 = 1196`
  - a word at `local=10.0s` in seg1 → `max(0, 10−2) + 598 = 606.0s` global
  - a word at `local=5.0s` in seg2 → `max(0, 5−2) + 1196 = 1199.0s` global
- Speaker ids are bare diarization integers and are **NOT stable across segments** → color speakers **per segment**, never carry identity across a boundary; never claim rep-vs-buyer.

## D. PENDING — requires a real recording + an iPhone device gate
The existing 21 recordings are **single-segment WebM only**; none exercises these:
1. **Cross-segment assembly strategy** — MSE+`timestampOffset` (iOS weak) vs **server-remux to one seekable container** vs **per-segment `<audio>` playlist behind a custom scrubber** (the safe iOS fallback). *Needs a real ≥10-min recording (two real segments).*
2. **iOS Safari decodability of MP4/AAC-origin chunks** — iOS MediaRecorder emits MP4, not WebM; the existing set has **no** MP4-origin recording. *Needs an iPhone recording.*
3. **Cross-boundary seek** (map global time → segment, swap source, resume) on a real iPhone.
4. **Playback survives lock / background-and-return** on iPhone.
5. Whether a schema migration (`recordings.playback_blob_url` + `playback_status`) is needed — **only if** server-remux wins (per-segment playlist needs none).

### To finalize (Felix):
- **How to sign into a Critiq preview on iPhone** (no `/api/test-auth` exists in Critiq).
- **Record a real ≥10-min call on your iPhone** (→ MP4-origin, 2 real segments), and ideally **one on desktop Chrome** (→ WebM, 2 real segments), so both codecs + the segment boundary are exercised.
- Then the iOS playback/seek/lock device gate signs off items D1–D4.

## HTTP contract (headless-verifiable on the preview, no iPhone)
`GET /api/recording/[id]/audio`: `auth()`→401, owner-scoped→404; `Accept-Ranges: bytes`; `206` + correct `Content-Range` + `Content-Length`; handles the iOS `bytes=0-1` probe; correct `Content-Type`; non-dense chunks → honest "unavailable." These are 38c acceptance criteria verifiable via `javascript_tool` fetch on the preview.

> ✅ **ALL SATISFIED by 38c — verified on the preview 2026-06-22** against real recordings (`41d87fd3` 50s, `ec923db9` 42s, seeded `33c19af1`): 401 unauthenticated (no body leak); `200` full body + valid WebM EBML magic `1a 45 df a3` + `Content-Length` == body + `Accept-Ranges: bytes` + `Cache-Control: private, no-store`; `206` for `bytes=0-1` (→ `bytes 0-1/TOTAL`) and a mid-range; **two adjacent ranges concatenate BYTE-IDENTICAL to the full body** (slice correctness); `416 bytes */TOTAL` over-EOF; `422 {"reason":"empty"}` honest-degrade on the no-audio seeded score; the `<audio>` element reaches `readyState 4`. (owner-scoped 404 is the same `getRecordingForUser` guard the 401 + owned-200/422 paths exercise.) Unit: `scripts/verify-phase38c.ts` 41/41.
