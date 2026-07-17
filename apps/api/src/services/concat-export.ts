import { createWriteStream } from 'node:fs'
import { unlink, mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pipeline } from 'node:stream/promises'
import ffmpeg from 'fluent-ffmpeg'
import { uploadToTos } from '../lib/storage.js'

// Use system ffmpeg if available, otherwise fall back to the installer package
try {
  const require = createRequire(import.meta.url)
  const installer = require('@ffmpeg-installer/ffmpeg')
  ffmpeg.setFfmpegPath(installer.path)
} catch {
  // system ffmpeg will be used
}

export interface ConcatJob {
  status: 'processing' | 'done' | 'failed'
  resultUrl?: string
  error?: string
}

export type ConcatJobStore = Map<string, ConcatJob>

interface Segment {
  url: string
  inPoint: number
  outPoint: number
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`)
  const ws = createWriteStream(dest)
  await pipeline(res.body as any, ws)
}

function trimVideo(input: string, output: string, inPoint: number, outPoint: number): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .setStartTime(inPoint)
      .setDuration(outPoint - inPoint)
      .outputOptions(['-c copy'])
      .output(output)
      .on('end', () => resolve())
      .on('error', reject)
      .run()
  })
}

function concatVideos(listFile: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(listFile)
      .inputOptions(['-f concat', '-safe 0'])
      .outputOptions(['-c copy'])
      .output(output)
      .on('end', () => resolve())
      .on('error', reject)
      .run()
  })
}

export async function runConcatExport(
  jobId: string,
  segments: Segment[],
  projectName: string,
  jobStore: ConcatJobStore,
  db: any,
): Promise<void> {
  const tmpDir = join('/tmp', `concat-${jobId}`)
  await mkdir(tmpDir, { recursive: true })

  const updateJob = async (update: Partial<ConcatJob>) => {
    const current = jobStore.get(jobId) ?? { status: 'processing' }
    const next = { ...current, ...update }
    jobStore.set(jobId, next)
    await db.updateTable('concat_jobs' as any)
      .set({ status: next.status, result_url: next.resultUrl ?? null, error: next.error ?? null, updated_at: new Date() })
      .where('id', '=', jobId)
      .execute()
  }

  try {
    const trimmedPaths: string[] = []

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      const rawPath = join(tmpDir, `raw-${i}.mp4`)
      const trimPath = join(tmpDir, `trim-${i}.mp4`)

      await downloadFile(seg.url, rawPath)
      await trimVideo(rawPath, trimPath, seg.inPoint, seg.outPoint)
      trimmedPaths.push(trimPath)
    }

    const listContent = trimmedPaths.map((p) => `file '${p}'`).join('\n')
    const listFile = join(tmpDir, 'concat.txt')
    await writeFile(listFile, listContent)

    const outputPath = join(tmpDir, 'output.mp4')
    await concatVideos(listFile, outputPath)

    const buf = await readFile(outputPath)
    const key = `concat-exports/${jobId}/${projectName.replace(/[^a-zA-Z0-9_-]/g, '_')}_final.mp4`
    const resultUrl = await uploadToTos(key, buf, 'video/mp4')

    await updateJob({ status: 'done', resultUrl })
  } catch (err) {
    await updateJob({ status: 'failed', error: err instanceof Error ? err.message : String(err) })
  } finally {
    // cleanup tmp files
    const { rm } = await import('node:fs/promises')
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}
