import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const distDirectory = path.join(projectRoot, "dist");

const budgets = {
  browserEntry: 1_075_000,
  browserLargestNonEntry: 650_000,
  browserJavaScript: 3_900_000,
  browserJavaScriptChunks: 260,
  browserCss: 45_000,
  browserDist: 4_450_000,
  worker: 400_000,
  standaloneServer: 425_000,
};

async function requireFile(filePath) {
  let fileStats;
  try {
    fileStats = await stat(filePath);
  } catch {
    throw new Error(`Required artifact is missing: ${path.relative(projectRoot, filePath)}`);
  }
  if (!fileStats.isFile()) {
    throw new Error(`Required artifact is not a file: ${path.relative(projectRoot, filePath)}`);
  }
  return fileStats.size;
}

async function listFiles(directory, rootDirectory = directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    throw new Error(`Required artifact directory is missing: ${path.relative(projectRoot, directory)}`);
  }

  const files = [];
  entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(absolutePath, rootDirectory));
    } else if (entry.isFile()) {
      files.push({
        absolutePath,
        relativePath: path.relative(rootDirectory, absolutePath).split(path.sep).join("/"),
        size: (await stat(absolutePath)).size,
      });
    }
  }
  return files;
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return match?.[1] ?? match?.[2];
}

function findBrowserEntry(html, javaScriptFiles) {
  const sources = (html.match(/<script\b[^>]*>/gi) ?? []).flatMap((tag) => {
    const type = attribute(tag, "type");
    const source = attribute(tag, "src");
    return type?.toLowerCase() === "module" && source ? [source] : [];
  });
  if (sources.length !== 1) {
    throw new Error(`Expected one module entry in dist/index.html, found ${sources.length}`);
  }

  const baseUrl = new URL("https://artifact.invalid/");
  const entryUrl = new URL(sources[0], baseUrl);
  if (entryUrl.origin !== baseUrl.origin) {
    throw new Error(`Browser entry must be local: ${sources[0]}`);
  }
  const entryPath = decodeURIComponent(entryUrl.pathname);
  const matches = javaScriptFiles.filter((file) => {
    const relativeUrl = `/${file.relativePath}`;
    return entryPath === relativeUrl || entryPath.endsWith(relativeUrl);
  });
  if (matches.length !== 1) {
    throw new Error(`Expected the browser entry ${sources[0]} to match one built JavaScript file, found ${matches.length}`);
  }
  return matches[0];
}

function sumSizes(files) {
  return files.reduce((total, file) => total + file.size, 0);
}

async function main() {
  const indexPath = path.join(distDirectory, "index.html");
  await requireFile(indexPath);
  const browserFiles = await listFiles(distDirectory);
  const javaScriptFiles = browserFiles.filter((file) => file.relativePath.endsWith(".js"));
  const cssFiles = browserFiles.filter((file) => file.relativePath.endsWith(".css"));
  if (cssFiles.length === 0) {
    throw new Error("Required browser CSS artifact is missing from dist");
  }

  const entry = findBrowserEntry(await readFile(indexPath, "utf8"), javaScriptFiles);
  const nonEntryJavaScript = javaScriptFiles.filter((file) => file.absolutePath !== entry.absolutePath);
  const workerPath = path.join(projectRoot, "dist-worker", "index.js");
  const serverPath = path.join(projectRoot, "dist-server", "server.js");
  const workerSize = await requireFile(workerPath);
  const serverSize = await requireFile(serverPath);

  console.log(`Browser entry file: ${entry.relativePath}`);
  console.log(`Worker file: ${path.relative(projectRoot, workerPath)}`);
  console.log(`Standalone server file: ${path.relative(projectRoot, serverPath)}`);

  const checks = [
    ["Browser entry JavaScript bytes", entry.size, budgets.browserEntry],
    ["Largest non-entry JavaScript bytes", Math.max(0, ...nonEntryJavaScript.map((file) => file.size)), budgets.browserLargestNonEntry],
    ["All browser JavaScript bytes", sumSizes(javaScriptFiles), budgets.browserJavaScript],
    ["Browser JavaScript chunk count", javaScriptFiles.length, budgets.browserJavaScriptChunks],
    ["All browser CSS bytes", sumSizes(cssFiles), budgets.browserCss],
    ["Entire dist bytes", sumSizes(browserFiles.filter((file) => path.basename(file.relativePath) !== ".DS_Store")), budgets.browserDist],
    ["Worker index.js bytes", workerSize, budgets.worker],
    ["Standalone server.js bytes", serverSize, budgets.standaloneServer],
  ];

  let failed = false;
  for (const [label, actual, budget] of checks) {
    const passed = actual <= budget;
    console.log(`${label}: ${actual} / ${budget} (${passed ? "PASS" : "FAIL"})`);
    failed ||= !passed;
  }
  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
