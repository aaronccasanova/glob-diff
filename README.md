# glob-diff

A lightweight utility for tracking file changes in your project by creating snapshots based on glob patterns. This library hashes files and records their modification times to efficiently detect when files have been created, updated, or deleted.

## Features

- Track file changes between snapshots (create, update, delete)
- Efficient file comparison using modification timestamps and content hashing
- Flexible glob pattern support through [globby](https://github.com/sindresorhus/globby)
- Multiple snapshot support for different file groups
- Simple API with sensible defaults

## Installation

```sh
npm i glob-diff
```

## Usage

### Basic Example

Track changes to all JavaScript files in your project:

```ts
import { globDiff } from 'glob-diff'

// Detect changes in JavaScript files
const { changes, snapshot } = await globDiff('**/*.js')

console.log('Changes:', changes)
//=> [{ type: 'create', filePath: '/path/to/file.js' }]

// `snapshot` is automatically saved to `.glob-diff.json`
// in the current directory and used for future comparisons.
```

### Multiple Snapshots

Track different file types with separate snapshots:

```ts
import { globDiff } from 'glob-diff'

// Track CSS files
const cssResult = await globDiff('**/*.css', {
  snapshotFilePath: '.glob-diff-css.json',
})

// Track JavaScript files
const jsResult = await globDiff('**/*.js', {
  snapshotFilePath: '.glob-diff-js.json',
})

console.log('CSS changes:', cssResult.changes)
console.log('JS changes:', jsResult.changes)
```

### One-time Comparison (No Saving)

Run a comparison without saving the snapshot:

```ts
import { globDiff } from 'glob-diff'

// Check for changes but don't save the snapshot
const tempResult = await globDiff('temp/**/*.js', {
  saveSnapshot: false,
})

console.log('Temporary file changes:', tempResult.changes)
```

### Advanced Options

Use the full options object for more control:

```ts
import { globDiff } from 'glob-diff'

const result = await globDiff({
  // Use glob patterns
  patterns: ['src/**/*.ts', '!src/**/*.test.ts'],

  // Or directly pass an array of files
  files: ['src/index.ts', 'src/utils.ts'],

  // Or specify exact files
  // files: ['src/index.ts', 'src/utils.ts'],

  // Change working directory
  cwd: './packages/my-package',

  // Always hash files even if timestamps haven't changed
  alwaysHash: true,

  // Custom snapshot file location
  snapshotFilePath: '.glob-diff-custom.json',

  // Provide an existing snapshot object
  // snapshot: existingSnapshotObject,
})
```

## API

### globDiff(patterns, options?)

### globDiff(options)

Returns a Promise that resolves to a `GlobDiffResult` containing:

- `snapshot`: The new snapshot object
- `changes`: An array of file changes with `type` ('create', 'update', or 'delete') and `filePath`

See the TypeScript definitions in the source code for complete type information.
