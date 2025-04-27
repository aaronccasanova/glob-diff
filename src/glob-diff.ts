import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { globby } from 'globby'
import { hashFile } from 'hasha'

type GlobbyParameters = Parameters<typeof globby>
type GlobbyOptions = NonNullable<GlobbyParameters[1]>

type GlobDiffPatterns = GlobbyParameters[0]

type GlobDiffChangeType = 'create' | 'delete' | 'update'

interface GlobDiffChange {
  type: GlobDiffChangeType
  filePath: string
}

interface GlobDiffFileSnapshot {
  hash: string
  mtimeMs: number
}

interface GlobDiffSnapshot {
  [filePath: string]: GlobDiffFileSnapshot
}

interface GlobDiffOptions {
  /**
   * When true, always calculate file hashes regardless of timestamp.
   * Use this for environments where file contents might change without
   * updating timestamps.
   * @default false
   */
  alwaysHash?: boolean
  /**
   * The current working directory in which to search.
   * Defaults to `process.cwd()`.
   */
  cwd?: GlobbyOptions['cwd']
  /**
   * Glob patterns to match files
   * Not required if `files` is provided
   */
  patterns?: GlobDiffPatterns
  /**
   * Optional list of file paths to use instead of globbing.
   * If provided, patterns will be ignored and these files will be used directly.
   */
  files?: string[]
  /**
   * When true, automatically saves the snapshot after diff is complete
   * @default true
   */
  saveSnapshot?: boolean
  /**
   * Previous snapshot object to compare against
   * If provided, this takes precedence over snapshotFilePath
   */
  snapshot?: GlobDiffSnapshot
  /**
   * Path to a previous snapshot file to load and save to
   * If not provided, will use defaultGlobDiffSnapshotFileName
   */
  snapshotFilePath?: string
}

interface GlobDiffResult {
  /**
   * The new snapshot of the matched files
   */
  snapshot: GlobDiffSnapshot

  /**
   * List of changes between the previous and new snapshot
   */
  changes: GlobDiffChange[]
}

const defaultGlobDiffSnapshotFileName = '.glob-diff.json'

export async function globDiff(
  options: GlobDiffOptions,
): Promise<GlobDiffResult>
export async function globDiff(
  patterns: GlobDiffPatterns,
  options?: Omit<GlobDiffOptions, 'patterns'>,
): Promise<GlobDiffResult>
export async function globDiff(
  patternsOrOptions: GlobDiffPatterns | GlobDiffOptions,
  maybeOptions?: Omit<GlobDiffOptions, 'patterns'>,
): Promise<GlobDiffResult> {
  const options: GlobDiffOptions = isGlobDiffPatterns(patternsOrOptions)
    ? { patterns: patternsOrOptions, ...maybeOptions }
    : patternsOrOptions

  const snapshotFilePath = path.resolve(
    options.snapshotFilePath || defaultGlobDiffSnapshotFileName,
  )

  let previousSnapshot: GlobDiffSnapshot | undefined = options.snapshot

  if (previousSnapshot && !isValidGlobDiffSnapshot(previousSnapshot)) {
    throw new Error('Invalid `glob-diff` snapshot')
  }

  if (!previousSnapshot) {
    previousSnapshot = await loadGlobDiffSnapshot(snapshotFilePath)
  }

  if (!options.patterns && !options.files) {
    throw new Error('Either `patterns` or `files` must be provided')
  }

  const snapshot = await getGlobDiffSnapshot({
    alwaysHash: options.alwaysHash,
    cwd: options.cwd,
    files: options.files,
    patterns: options.patterns,
    snapshot: previousSnapshot,
  })

  const changes = getGlobDiffChanges(previousSnapshot, snapshot)

  if (options.saveSnapshot !== false) {
    await fs.promises.writeFile(snapshotFilePath, JSON.stringify(snapshot))
  }

  return {
    snapshot,
    changes,
  }
}

interface GetGlobDiffSnapshotOptions {
  /**
   * When true, always calculate file hashes regardless of timestamp
   * @default false
   */
  alwaysHash?: boolean
  /**
   * The current working directory in which to search.
   * Defaults to `process.cwd()`.
   */
  cwd?: GlobbyOptions['cwd']
  /**
   * Optional list of file paths to use instead of globbing.
   * If provided, patterns will be ignored and these files will be used directly.
   */
  files?: string[]
  /**
   * Glob patterns to match files
   * Not required if `files` is provided
   */
  patterns?: GlobDiffPatterns
  /**
   * Previous snapshot to compare against for optimization
   */
  snapshot?: GlobDiffSnapshot
}

async function getGlobDiffSnapshot(
  options: GetGlobDiffSnapshotOptions = {},
): Promise<GlobDiffSnapshot> {
  const patterns = options.patterns || []

  const filePaths = options.files
    ? options.files.map((filePath) => path.resolve(filePath))
    : await globby(patterns, { absolute: true })

  const snapshot: GlobDiffSnapshot = {}
  const previousSnapshot = options.snapshot || {}

  await Promise.all(
    filePaths.map(async (filePath) => {
      const fileStats = await fs.promises.stat(filePath)

      // Check if file exists in previous snapshot and has the same modification time
      if (
        !options.alwaysHash &&
        previousSnapshot[filePath]?.mtimeMs === fileStats.mtimeMs
      ) {
        // Reuse the previous hash if timestamp hasn't changed
        snapshot[filePath] = {
          hash: previousSnapshot[filePath].hash,
          mtimeMs: fileStats.mtimeMs,
        }
      } else {
        // File is new or has been modified, compute the hash
        const fileHash = await hashFile(filePath, { algorithm: 'md5' })

        snapshot[filePath] = {
          hash: fileHash,
          mtimeMs: fileStats.mtimeMs,
        }
      }
    }),
  )

  return snapshot
}

function getGlobDiffChanges(
  previousSnapshot: GlobDiffSnapshot,
  nextSnapshot: GlobDiffSnapshot,
): GlobDiffChange[] {
  const changes: GlobDiffChange[] = []

  const previousFilePaths = new Set(Object.keys(previousSnapshot))
  const nextFilePaths = new Set(Object.keys(nextSnapshot))

  for (const previousFilePath of previousFilePaths) {
    if (!nextFilePaths.has(previousFilePath)) {
      changes.push({
        type: 'delete',
        filePath: previousFilePath,
      })
    }
  }

  for (const nextFilePath of nextFilePaths) {
    if (!previousFilePaths.has(nextFilePath)) {
      changes.push({
        type: 'create',
        filePath: nextFilePath,
      })
    } else {
      if (
        previousSnapshot[nextFilePath]?.hash !==
        nextSnapshot[nextFilePath]?.hash
      ) {
        changes.push({
          type: 'update',
          filePath: nextFilePath,
        })
      }
    }
  }

  return changes
}

async function loadGlobDiffSnapshot(
  snapshotFilePath: string,
): Promise<GlobDiffSnapshot> {
  const snapshotFileContent = await fs.promises
    .readFile(snapshotFilePath, 'utf8')
    .catch(() => undefined)

  if (!snapshotFileContent) return {}

  const snapshot = JSON.parse(snapshotFileContent)

  if (!isValidGlobDiffSnapshot(snapshot)) {
    throw new Error('Invalid `glob-diff` snapshot file')
  }

  return snapshot
}

function isValidGlobDiffSnapshot(snapshot: any): snapshot is GlobDiffSnapshot {
  if (typeof snapshot !== 'object' || snapshot === null) {
    return false
  }

  for (const [filePath, fileSnapshot] of Object.entries(snapshot)) {
    if (
      typeof filePath !== 'string' ||
      typeof fileSnapshot !== 'object' ||
      fileSnapshot === null ||
      !('hash' in fileSnapshot) ||
      !('mtimeMs' in fileSnapshot) ||
      typeof fileSnapshot.hash !== 'string' ||
      typeof fileSnapshot.mtimeMs !== 'number'
    ) {
      return false
    }
  }

  return true
}

function isGlobDiffPatterns(
  patternsOrOptions: unknown,
): patternsOrOptions is GlobDiffPatterns {
  return (
    typeof patternsOrOptions === 'string' || Array.isArray(patternsOrOptions)
  )
}
