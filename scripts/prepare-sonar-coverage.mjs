import { access, mkdir, readFile, writeFile } from "node:fs/promises"

const SOURCE = "coverage/lcov.info"
const TARGET = "coverage/sonar.lcov.info"

const fileExists = async path => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const normalizeSourcePath = sourcePath => {
  const normalized = sourcePath.replaceAll("\\", "/")

  if (normalized.startsWith("/")) {
    return normalized
  }

  if (normalized.startsWith("src/")) {
    return normalized
  }

  if (normalized.startsWith("./src/")) {
    return normalized.slice(2)
  }

  return `src/${normalized}`
}

const isTestCoveragePath = path =>
  path.includes(".test.") ||
  path.includes(".integration.test.") ||
  path.includes(".typecheck.")

const rewriteCoverageFile = content =>
  content
    .split("end_of_record")
    .map(record => record.trim())
    .filter(Boolean)
    .flatMap(record => {
      const lines = record.split("\n")
      const sourceLine = lines.find(line => line.startsWith("SF:"))

      if (!sourceLine) {
        return []
      }

      const sourcePath = sourceLine.slice(3)
      const normalizedPath = normalizeSourcePath(sourcePath)

      if (isTestCoveragePath(normalizedPath)) {
        return []
      }

      return [
        lines
          .map(line => (line.startsWith("SF:") ? `SF:${normalizedPath}` : line))
          .join("\n"),
      ]
    })
    .map(record => `${record}\nend_of_record`)
    .join("\n")

if (!(await fileExists(SOURCE))) {
  throw new Error(
    "No LCOV report found. Run `npm run test:ci` before preparing Sonar coverage.",
  )
}

const content = await readFile(SOURCE, "utf8")
const rewritten = rewriteCoverageFile(content).trim()

if (!rewritten) {
  throw new Error("Prepared Sonar coverage report is empty.")
}

await mkdir("coverage", { recursive: true })
await writeFile(TARGET, `${rewritten}\n`, "utf8")

console.log(`Prepared Sonar coverage report: ${TARGET}`)
