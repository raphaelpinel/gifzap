#!/usr/bin/env node

import { access, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import {
  basename,
  dirname,
  extname,
  join,
  relative,
  resolve,
  sep
} from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov"]);
const execFileAsync = promisify(execFile);

function printHelp() {
  console.log(`gifzap

Convert a short video into a GIF using ffmpeg.

Usage:
  gifzap [input] [output] [options]

Arguments:
  input                 Optional path to the source video
  output                Optional output path (defaults to <input>.gif)

Options:
  --fps <number>        GIF frame rate (default: 12)
  --width <pixels>      Output width in pixels, keeping aspect ratio (default: 800)
  --speed <number>      Playback speed multiplier (default: 1)
  --start <time>        Start time, e.g. 00:00:01.5
  --duration <time>     Duration to convert, e.g. 3 or 00:00:03
  --screenshots-dir <path>
                        Extra folder to search for recent recordings
  --replace             Replace the latest demo*.gif in the repo
  --overwrite           Replace the output file if it already exists
  -h, --help            Show this message

Examples:
  gifzap
  gifzap --replace
  gifzap --speed 2
  gifzap --screenshots-dir ~/Screenshots
  gifzap demo.mp4
  gifzap demo.mp4 assets/demo.gif --width 720 --fps 10
  gifzap demo.mp4 --start 00:00:01 --duration 2.5
`);
}

function fail(message, exitCode = 1) {
  console.error(`Error: ${message}`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const positional = [];
  const options = {
    fps: "12",
    speed: "1",
    width: "800",
    overwrite: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }

    if (arg === "--overwrite") {
      options.overwrite = true;
      continue;
    }

    if (arg === "--replace") {
      options.replace = true;
      continue;
    }

    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[index + 1];

      if (!value || value.startsWith("--")) {
        fail(`Missing value for --${key}`);
      }

      if (!["fps", "width", "speed", "start", "duration", "screenshots-dir"].includes(key)) {
        fail(`Unknown option: ${arg}`);
      }

      options[key] = value;
      index += 1;
      continue;
    }

    positional.push(arg);
  }

  return { positional, options };
}

function validatePositiveNumber(label, value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    fail(`${label} must be a positive number. Received: ${value}`);
  }

  return parsed;
}

async function ensureReadable(path) {
  try {
    await access(path, constants.R_OK);
  } catch {
    fail(`Cannot read input file: ${path}`);
  }
}

async function pathExists(path) {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function collectVideos(directory, recursive) {
  if (!(await pathExists(directory))) {
    return [];
  }

  const entries = await readdir(directory, { withFileTypes: true });
  const videos = [];

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (recursive) {
        videos.push(...(await collectVideos(fullPath, true)));
      }

      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = extname(entry.name).toLowerCase();

    if (!VIDEO_EXTENSIONS.has(extension)) {
      continue;
    }

    const details = await stat(fullPath);
    videos.push({ path: fullPath, modifiedMs: details.mtimeMs });
  }

  return videos;
}

async function collectGifOutputs(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const gifs = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    if (!/^demo(?:-\d+)?\.gif$/i.test(entry.name)) {
      continue;
    }

    const fullPath = join(directory, entry.name);
    const details = await stat(fullPath);
    gifs.push({ path: fullPath, modifiedMs: details.mtimeMs });
  }

  return gifs;
}

async function findReadmePath(directory) {
  const candidates = ["README.md", "Readme.md", "readme.md"];

  for (const candidate of candidates) {
    const fullPath = join(directory, candidate);

    if (await pathExists(fullPath)) {
      return fullPath;
    }
  }

  return null;
}

function getSearchDirectories(screenshotsDir) {
  const directories = [{ path: process.cwd(), recursive: true }];

  const configuredScreenshotsDir =
    screenshotsDir ||
    process.env.SCREENSHOTS_DIR ||
    process.env.GIFZAP_SCREENSHOTS_DIR;

  if (configuredScreenshotsDir) {
    directories.push({
      path: resolve(configuredScreenshotsDir),
      recursive: false
    });
  }

  return directories;
}

async function getMacOsScreenshotLocation() {
  try {
    const { stdout } = await execFileAsync("defaults", [
      "read",
      "com.apple.screencapture",
      "location"
    ]);
    const path = stdout.trim();

    if (!path) {
      return null;
    }

    if (path.startsWith("~")) {
      return join(homedir(), path.slice(2));
    }

    return resolve(path);
  } catch {
    return null;
  }
}

async function findLatestVideoInDirectories(directories) {
  const candidates = [];

  for (const directory of directories) {
    candidates.push(
      ...(await collectVideos(directory.path, directory.recursive))
    );
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => right.modifiedMs - left.modifiedMs);
  return candidates[0].path;
}

async function promptForDirectory() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return null;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const answer = await rl.question(
      "No recent videos found. Paste your screenshots folder, or press Enter to cancel: "
    );

    if (!answer.trim()) {
      return null;
    }

    return resolve(answer.trim());
  } finally {
    rl.close();
  }
}

async function findLatestVideo(screenshotsDir) {
  const directories = getSearchDirectories(screenshotsDir);
  const macOsScreenshotLocation = await getMacOsScreenshotLocation();

  if (
    macOsScreenshotLocation &&
    !directories.some((directory) => directory.path === macOsScreenshotLocation)
  ) {
    directories.push({ path: macOsScreenshotLocation, recursive: false });
  }

  const discovered = await findLatestVideoInDirectories(directories);

  if (discovered) {
    return discovered;
  }

  const promptedDirectory = await promptForDirectory();

  if (promptedDirectory) {
    const promptedResult = await findLatestVideoInDirectories([
      { path: promptedDirectory, recursive: false }
    ]);

    if (promptedResult) {
      return promptedResult;
    }

    fail(`No .mp4 or .mov files found in ${promptedDirectory}`);
  }

  const searchedPaths = directories.map((directory) => directory.path).join(", ");
  fail(
    `No .mp4 or .mov files found in ${searchedPaths}.\n` +
      "\nTry checking your macOS screenshot location:\n" +
      "  defaults read com.apple.screencapture location\n" +
      "\nOr run:\n" +
      '  gifzap --screenshots-dir "/path/to/your/Screenshots"\n' +
      "\nYou can also set it once:\n" +
      '  export SCREENSHOTS_DIR="/path/to/your/Screenshots"'
  );
}

function run(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: "inherit" });

    child.on("error", (error) => {
      rejectPromise(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function getDefaultOutputPath(overwrite) {
  const baseName = "demo";
  let index = 1;

  while (true) {
    const fileName = index === 1 ? `${baseName}.gif` : `${baseName}-${index}.gif`;
    const candidate = resolve(process.cwd(), fileName);

    if (overwrite || !(await pathExists(candidate))) {
      return candidate;
    }

    index += 1;
  }
}

async function getReplaceOutputPath() {
  const candidates = await collectGifOutputs(process.cwd());

  if (candidates.length === 0) {
    return resolve(process.cwd(), "demo.gif");
  }

  candidates.sort((left, right) => right.modifiedMs - left.modifiedMs);
  return candidates[0].path;
}

function toMarkdownPath(path) {
  return path.split(sep).join("/");
}

async function attachGifToReadme(output) {
  const readmePath = await findReadmePath(process.cwd());

  if (!readmePath) {
    return;
  }

  const relativeOutputPath = relative(process.cwd(), output);

  if (
    !relativeOutputPath ||
    relativeOutputPath.startsWith("..") ||
    relativeOutputPath === basename(readmePath)
  ) {
    return;
  }

  const markdownPath = toMarkdownPath(relativeOutputPath);
  const existingContents = await readFile(readmePath, "utf8");
  const imageLine = `![${basename(output, extname(output))}](${markdownPath})`;

  if (existingContents.includes(imageLine)) {
    return;
  }

  const lines = existingContents.split("\n");
  const titleIndex = lines.findIndex((line) => line.startsWith("# "));
  let nextContents;

  if (titleIndex >= 0) {
    lines.splice(titleIndex + 1, 0, "", imageLine);
    nextContents = `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
  } else {
    const attachment = `\n\n${imageLine}\n`;
    nextContents = existingContents.endsWith("\n")
      ? `${existingContents}${attachment.trimStart()}`
      : `${existingContents}${attachment}`;
  }

  await writeFile(readmePath, nextContents, "utf8");
  console.log(`Attached GIF to ${readmePath}`);
}

async function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const [inputArg, outputArg] = positional;
  const usingAutoDetectedInput = !inputArg;
  const input = usingAutoDetectedInput
    ? await findLatestVideo(options["screenshots-dir"])
    : resolve(inputArg);

  await ensureReadable(input);

  const fps = validatePositiveNumber("fps", options.fps);
  const speed = validatePositiveNumber("speed", options.speed);
  const width = Math.round(validatePositiveNumber("width", options.width));

  const inputExtension = extname(input);
  const inputBase = basename(input, inputExtension);
  const output = outputArg
    ? resolve(outputArg)
    : usingAutoDetectedInput
      ? options.replace
        ? await getReplaceOutputPath()
        : await getDefaultOutputPath(options.overwrite)
      : resolve(join(dirname(input), `${inputBase}.gif`));

  const filter = [
    `setpts=${1 / speed}*PTS`,
    `fps=${fps}`,
    `scale=${width}:-1:flags=lanczos`,
    "split[s0][s1]",
    "[s0]palettegen=stats_mode=single[p]",
    "[s1][p]paletteuse=new=1"
  ].join(",");

  const args = [];

  args.push("-hide_banner", "-loglevel", "error");

  if (options.overwrite) {
    args.push("-y");
  } else {
    args.push("-n");
  }

  if (options.start) {
    args.push("-ss", options.start);
  }

  args.push("-i", input);

  if (options.duration) {
    args.push("-t", options.duration);
  }

  args.push("-vf", filter, output);

  try {
    if (usingAutoDetectedInput) {
      console.log(`Using latest video: ${input}`);
    }

    await run("ffmpeg", args);
    console.log(`Created ${output}`);

    if (usingAutoDetectedInput) {
      await attachGifToReadme(output);
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

main();
