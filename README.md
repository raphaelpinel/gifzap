# gifzap

Small CLI utility for turning a short video into a GIF that works well in GitHub repos, pull requests, and docs.

## Requirements

- [ffmpeg](https://ffmpeg.org/) installed and available on your `PATH`
- Node.js 18+

## Usage

Run it directly with Node:

```bash
node ./bin/gifzap.js
```

Or install it locally for command-style usage:

```bash
npm install
npm link
gifzap
```

After `npm link`, `gifzap` is available as a command in any repo on your machine. It always uses the repo you run it from as the primary working directory, so running it inside a different repo will make that repo the primary place it looks for videos, where it writes the generated GIF, and which `README.md` it updates.

With no input, `gifzap` picks the newest `.mp4` or `.mov` it can find in:

- the current repo directory, recursively
- your macOS Screenshot app save location, if one is configured

You can add your own screenshots directory with `--screenshots-dir <path>` or by setting `SCREENSHOTS_DIR`.

When it auto-detects a video, it writes the GIF into your current working directory and appends a Markdown image reference to `README.md` in that repo if one exists. If you pass an explicit input file, it creates `<input>.gif` next to that source video unless you provide an output path.

## Options

```bash
gifzap [input] [output] [options]
```

- `--fps <number>`: frame rate for the GIF, default `12`
- `--width <pixels>`: output width, default `800`
- `--start <time>`: start from a specific timestamp
- `--duration <time>`: only convert part of the video
- `--screenshots-dir <path>`: extra folder to search when auto-detecting
- `--overwrite`: replace the output file if it already exists

## Examples

Convert the newest recording from the repo or screenshots folder:

```bash
gifzap
```

That will create the GIF in the repo you are currently in and attach it to that repo's `README.md` when present.

Use your screenshots folder explicitly:

```bash
gifzap --screenshots-dir "/Users/your-name/Library/CloudStorage/OneDrive-Company/Screenshots"
```

Set it once in your shell:

```bash
export SCREENSHOTS_DIR="/Users/your-name/Library/CloudStorage/OneDrive-Company/Screenshots"
gifzap
```

Convert a short demo video:

```bash
gifzap demo.mp4
```

Create a smaller GIF for a README:

```bash
gifzap demo.mp4 assets/demo.gif --width 640 --fps 10
```

Trim a short moment out of a recording:

```bash
gifzap demo.mp4 preview.gif --start 00:00:02 --duration 3
```

## Tips for GitHub repos

- Keep clips short, usually `2` to `6` seconds
- Use `--width 640` or `--width 720` to keep file size reasonable
- Lower `--fps` to `8` or `10` if the GIF gets too large
- Start from a trimmed source clip when possible for the best results
![Screen Recording 2026-04-01 at 15.43.05](Screen Recording 2026-04-01 at 15.43.05.gif)
