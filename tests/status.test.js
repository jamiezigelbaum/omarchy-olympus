// Run with: node --test tests/
// Loads Status.js the way QML does (a plain script with a .pragma line) and
// checks the words the bar and panel show for each kind of report.
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")

const source = fs.readFileSync(path.join(__dirname, "..", "Status.js"), "utf8").replace(/^\.pragma library\s*$/m, "")
const S = {}
vm.runInNewContext(source + "\nthis.exports = { fromBrief, fromFullStatus, unavailable, barLabel, barText, barTone, stateWord, progressLine, summaryLine, formatEta };", S)
const { fromBrief, fromFullStatus, unavailable, barLabel, barText, barTone, stateWord, progressLine, summaryLine, formatEta } = S.exports

const brief = (fields) => JSON.stringify({ schema: "olympus.engine.brief.v1", state: "running", progress: null, blocker: null, needsYou: { count: 0, sentences: [] }, ...fields })

test("running with nothing to do reads Ready", () => {
  const view = fromBrief(brief({}))
  assert.equal(barLabel(view), "Ready")
  assert.equal(barTone(view), "normal")
  assert.equal(stateWord(view), "Running")
  assert.equal(summaryLine(view), "Everything is up to date.")
})

test("indexing shows percent in the bar and the full line in the panel", () => {
  const view = fromBrief(brief({ progress: { unit: "files", phase: "initial", percent: 42.7, itemsLeft: 1830, etaSeconds: 2400, stalled: false } }))
  assert.equal(barLabel(view), "Indexing 42%")
  assert.equal(progressLine(view.progress), "Indexing 42% · 1,830 files left · about 40 min")
})

test("a refresh says Refreshing and a single item is singular", () => {
  const view = fromBrief(brief({ progress: { unit: "messages", phase: "refresh", percent: 99, itemsLeft: 1, stalled: false } }))
  assert.equal(progressLine(view.progress), "Refreshing 99% · 1 message left")
})

test("stalled progress reads Indexing paused and drops the ETA", () => {
  const view = fromBrief(brief({ progress: { unit: "items", phase: "initial", percent: 10, itemsLeft: 5000, etaSeconds: 600, stalled: true } }))
  assert.equal(barLabel(view), "Indexing paused")
  assert.equal(progressLine(view.progress), "Indexing paused at 10% · 5,000 items left")
})

test("needs you outranks indexing and turns the bar urgent", () => {
  const view = fromBrief(brief({
    progress: { unit: "files", phase: "initial", percent: 42, itemsLeft: 10, stalled: false },
    needsYou: { count: 7, sentences: ["Reconnect Gmail", "Choose your privacy settings", "a", "b", "c", "d"] },
  }))
  assert.equal(barLabel(view), "Needs you")
  assert.equal(barTone(view), "urgent")
  assert.equal(view.needsYouCount, 7)
  assert.equal(view.needsYou.length, 5, "at most five sentences are kept")
})

test("a blocker alone also needs you", () => {
  const view = fromBrief(brief({ blocker: "Olympus can't reach your Mac." }))
  assert.equal(barLabel(view), "Needs you")
  assert.equal(view.blocker, "Olympus can't reach your Mac.")
})

test("stopped and starting outrank needs you", () => {
  assert.equal(barLabel(fromBrief(brief({ state: "stopped", needsYou: { count: 2, sentences: ["x"] } }))), "Stopped")
  assert.equal(barTone(fromBrief(brief({ state: "stopped" }))), "dim")
  assert.equal(barLabel(fromBrief(brief({ state: "starting" }))), "Starting…")
  assert.equal(barLabel(fromBrief(brief({ state: "not_installed" }))), "Not installed")
})

test("unhealthy reads Needs you", () => {
  const view = fromBrief(brief({ state: "unhealthy" }))
  assert.equal(barLabel(view), "Needs you")
  assert.equal(stateWord(view), "Not healthy")
})

test("only states, counts and sentences survive parsing", () => {
  const view = fromBrief(brief({
    needsYou: { count: 1, sentences: ["Reconnect Gmail"], items: [{ fix: { href: "https://example.invalid/?token=secret" } }] },
    token: "secret-token",
    progress: { unit: "files", phase: "initial", percent: 5, itemsLeft: 2, stalled: false, details: [{ stage: "x" }] },
  }))
  const text = JSON.stringify(view)
  assert.ok(!text.includes("secret"), text)
  assert.ok(!text.includes("details"), text)
  assert.deepEqual(Object.keys(view).sort(), ["attentionKnown", "blocker", "detail", "needsYou", "needsYouCount", "progress", "source", "state"])
})

test("non-brief output is not a brief", () => {
  assert.equal(fromBrief(""), null)
  assert.equal(fromBrief("Unknown engine status option: --brief"), null)
  assert.equal(fromBrief(JSON.stringify({ error: "invalid_params" })), null)
  assert.equal(fromBrief(JSON.stringify({ schema: "olympus.engine.brief.v2", state: "running" })), null)
})

test("an unknown state is shown as Unavailable, not trusted", () => {
  assert.equal(barLabel(fromBrief(brief({ state: "exploded" }))), "Unavailable")
})

test("a leading warning line before the JSON is tolerated", () => {
  assert.equal(barLabel(fromBrief("warning: something\n" + brief({}))), "Ready")
})

const full = (fields) => JSON.stringify({ ok: true, agent: { installed: true, state: "running" }, worker: { reachable: true }, missing: [], ...fields })

test("a running engine whose brief could not be read says Running, not Ready", () => {
  const view = fromBrief(brief({ needsYou: null, detail: "Olympus is running, but this version does not report progress here yet." }))
  assert.equal(barLabel(view), "Running")
  assert.equal(barTone(view), "normal")
  assert.equal(summaryLine(view), "Olympus is running, but this version does not report progress here yet.")
  assert.equal(summaryLine(fromBrief(brief({ needsYou: null }))), "Running. Couldn't read what needs you; open the dashboard to check.")
})

test("the full report gives running, starting and stopped", () => {
  assert.equal(barLabel(fromFullStatus(full({}))), "Running")
  assert.equal(summaryLine(fromFullStatus(full({}))), "Running. Update Olympus to see indexing progress and what needs you here.")
  assert.equal(barLabel(fromFullStatus(full({ ok: false, worker: { reachable: false } }))), "Starting…")
  assert.equal(barLabel(fromFullStatus(full({ ok: false, agent: { installed: true, state: "not_loaded" } }))), "Stopped")
  assert.equal(barLabel(fromFullStatus(full({ ok: false, agent: { installed: false, state: "not_loaded" } }))), "Not installed")
})

test("the full report's missing list becomes Needs you", () => {
  const view = fromFullStatus(full({ ok: false, missing: ["Remote access is on but the relay process is not running."] }))
  assert.equal(barLabel(view), "Needs you")
  assert.equal(view.needsYou[0], "Remote access is on but the relay process is not running.")
})

test("not ok with nothing missing reads Needs you as not healthy", () => {
  const view = fromFullStatus(full({ ok: false }))
  assert.equal(barLabel(view), "Needs you")
  assert.equal(stateWord(view), "Not healthy")
})

test("nothing parseable is unavailable", () => {
  assert.equal(fromFullStatus("bash: olympus: not found"), null)
  const view = unavailable("Couldn't run olympus.")
  assert.equal(barLabel(view), "Unavailable")
  assert.equal(barTone(view), "dim")
  assert.equal(summaryLine(view), "Couldn't run olympus.")
})

test("ETA wording", () => {
  assert.equal(formatEta(20), "under a minute")
  assert.equal(formatEta(59 * 60), "about 59 min")
  assert.equal(formatEta(90 * 60), "about 2 h")
  assert.equal(formatEta(30 * 3600), "about 1 day")
  assert.equal(formatEta(0), "")
  assert.equal(formatEta(null), "")
})

test("before the first check the bar says Checking", () => {
  assert.equal(barLabel(null), "Checking…")
  assert.equal(barTone(null), "dim")
})

test("a quiet Olympus shows the mountain alone; words appear only when something is happening", () => {
  assert.equal(barText(fromBrief(brief({}))), "")
  assert.equal(barText(fromBrief(brief({ needsYou: null }))), "")
  assert.equal(barText(unavailable("x")), "")
  assert.equal(barText(null), "")
  assert.equal(barText(fromBrief(brief({ progress: { unit: "files", phase: "initial", percent: 7, itemsLeft: 3, stalled: false } }))), "Indexing 7%")
  assert.equal(barText(fromBrief(brief({ needsYou: { count: 1, sentences: ["Reconnect Gmail"] } }))), "Needs you")
  assert.equal(barText(fromBrief(brief({ state: "stopped" }))), "Stopped")
  assert.equal(barText(fromBrief(brief({ state: "starting" }))), "Starting…")
})
