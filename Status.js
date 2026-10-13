.pragma library

// Turns what the olympus CLI prints into the few plain words the bar and the
// panel show. Pure functions only, so tests/status.test.js can run them under
// Node without a shell.
//
// Two inputs are understood:
//   olympus engine status --brief   schema olympus.engine.brief.v1 (preferred)
//   olympus engine status           the full report, for engines without --brief
// Only states, counts and the dashboard's own sentences are kept. Nothing else
// from either report is copied into the returned view.

var BRIEF_SCHEMA = "olympus.engine.brief.v1"
var MAX_SENTENCES = 5

var STATE_WORDS = {
  running: "Running",
  starting: "Starting",
  stopped: "Stopped",
  not_installed: "Not installed",
  unhealthy: "Not healthy",
  unavailable: "Unavailable"
}

function parseJsonObject(text) {
  var raw = String(text || "").trim()
  if (raw === "") return null
  // Tolerate a stray line before the object (a shell banner, a warning).
  var start = raw.indexOf("{")
  if (start > 0) raw = raw.substring(start)
  try {
    var value = JSON.parse(raw)
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null
  } catch (e) {
    return null
  }
}

function plainSentence(value) {
  var text = String(value === undefined || value === null ? "" : value).replace(/\s+/g, " ").trim()
  return text.length > 200 ? text.substring(0, 197) + "…" : text
}

function finiteNumber(value) {
  var n = Number(value)
  return isFinite(n) ? n : null
}

function sentenceList(values) {
  var out = []
  if (!Array.isArray(values)) return out
  for (var i = 0; i < values.length && out.length < MAX_SENTENCES; i++) {
    var sentence = plainSentence(values[i])
    if (sentence !== "") out.push(sentence)
  }
  return out
}

function emptyView(state) {
  return {
    state: state,
    progress: null,
    blocker: "",
    needsYouCount: 0,
    needsYou: [],
    detail: "",
    source: "",
    // False when the state was read but what needs the owner was not (an older
    // engine, or a brief the worker could not answer). The bar then says
    // Running, never Ready, so an unread problem is not shown as all clear.
    attentionKnown: false
  }
}

function knownState(value) {
  var state = String(value || "")
  return STATE_WORDS.hasOwnProperty(state) ? state : "unavailable"
}

function briefProgress(value) {
  if (!value || typeof value !== "object") return null
  var percent = finiteNumber(value.percent)
  if (percent === null) return null
  var itemsLeft = finiteNumber(value.itemsLeft)
  var eta = finiteNumber(value.etaSeconds)
  var unit = String(value.unit || "items")
  return {
    percent: Math.max(0, Math.min(100, Math.floor(percent))),
    itemsLeft: itemsLeft === null ? null : Math.max(0, Math.round(itemsLeft)),
    etaSeconds: eta === null || eta <= 0 ? null : eta,
    stalled: value.stalled === true,
    unit: unit === "files" || unit === "messages" ? unit : "items",
    phase: value.phase === "refresh" ? "refresh" : "initial"
  }
}

// `olympus engine status --brief`. Returns null when the text is not a brief.
function fromBrief(text) {
  var parsed = parseJsonObject(text)
  if (!parsed || parsed.schema !== BRIEF_SCHEMA) return null
  var view = emptyView(knownState(parsed.state))
  view.source = "brief"
  view.progress = briefProgress(parsed.progress)
  view.blocker = plainSentence(parsed.blocker)
  var needs = parsed.needsYou && typeof parsed.needsYou === "object" ? parsed.needsYou : null
  view.attentionKnown = needs !== null
  needs = needs || {}
  view.needsYou = sentenceList(needs.sentences)
  var count = finiteNumber(needs.count)
  view.needsYouCount = Math.max(view.needsYou.length, count === null ? 0 : Math.round(count))
  view.detail = plainSentence(parsed.detail)
  return view
}

// The full `olympus engine status` report, for an engine that predates
// --brief. It can say running or stopped and name engine-level problems; it
// has no indexing progress.
function fromFullStatus(text) {
  var parsed = parseJsonObject(text)
  if (!parsed || !parsed.agent || typeof parsed.agent !== "object") return null
  var agent = parsed.agent
  var worker = parsed.worker && typeof parsed.worker === "object" ? parsed.worker : {}
  var state
  if (agent.installed === false) state = "not_installed"
  else if (agent.state === "running") state = worker.reachable === true ? "running" : "starting"
  else state = "stopped"
  var view = emptyView(state)
  view.source = "full"
  if (state === "running" && parsed.ok === false) {
    var missing = Array.isArray(parsed.missing) ? parsed.missing : []
    view.needsYou = sentenceList(missing)
    view.needsYouCount = missing.length
    if (view.needsYouCount === 0) view.state = "unhealthy"
  }
  return view
}

function unavailable(detail) {
  var view = emptyView("unavailable")
  view.detail = plainSentence(detail)
  return view
}

function needsOwner(view) {
  return !!view && (view.state === "unhealthy" || view.blocker !== "" || view.needsYouCount > 0)
}

// The words in the bar. Stopped and starting outrank everything; once the
// engine runs, anything that needs the owner outranks indexing.
function barLabel(view) {
  if (!view) return "Checking…"
  switch (view.state) {
    case "stopped": return "Stopped"
    case "starting": return "Starting…"
    case "not_installed": return "Not installed"
    case "unavailable": return "Unavailable"
  }
  if (needsOwner(view)) return "Needs you"
  if (view.progress) return view.progress.stalled ? "Indexing paused" : "Indexing " + view.progress.percent + "%"
  return view.attentionKnown ? "Ready" : "Running"
}

// normal | urgent | dim: how the bar colours the label.
function barTone(view) {
  if (!view) return "dim"
  if (view.state === "running" || view.state === "unhealthy") return needsOwner(view) ? "urgent" : "normal"
  if (view.state === "starting") return "normal"
  return "dim"
}

function stateWord(view) {
  return view ? STATE_WORDS[view.state] || STATE_WORDS.unavailable : "Checking"
}

function groupDigits(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

function formatEta(seconds) {
  var s = finiteNumber(seconds)
  if (s === null || s <= 0) return ""
  var minutes = Math.round(s / 60)
  if (minutes < 1) return "under a minute"
  if (minutes < 60) return "about " + minutes + " min"
  var hours = Math.round(minutes / 60)
  if (hours < 24) return "about " + hours + " h"
  var days = Math.round(hours / 24)
  return "about " + days + (days === 1 ? " day" : " days")
}

function unitWord(unit, count) {
  var singular = unit === "files" ? "file" : (unit === "messages" ? "message" : "item")
  return count === 1 ? singular : singular + "s"
}

// "Indexing 42% · 1,830 files left · about 40 min"
function progressLine(progress) {
  if (!progress) return ""
  var verb = progress.phase === "refresh" ? "Refreshing" : "Indexing"
  var parts = [progress.stalled ? verb + " paused at " + progress.percent + "%" : verb + " " + progress.percent + "%"]
  if (progress.itemsLeft !== null && progress.itemsLeft > 0)
    parts.push(groupDigits(progress.itemsLeft) + " " + unitWord(progress.unit, progress.itemsLeft) + " left")
  if (!progress.stalled) {
    var eta = formatEta(progress.etaSeconds)
    if (eta !== "") parts.push(eta)
  }
  return parts.join(" · ")
}

// One sentence under the panel title when there is nothing more specific.
function summaryLine(view) {
  if (!view) return "Checking Olympus…"
  if (view.detail !== "") return view.detail
  switch (view.state) {
    case "stopped": return "Olympus is not running. Start it with olympus engine start."
    case "starting": return "Olympus is starting up."
    case "not_installed": return "Olympus is not installed for this account."
    case "unhealthy": return "Olympus is running but not healthy. See olympus engine logs."
    case "unavailable": return "Couldn't read Olympus's status."
  }
  if (view.progress) return ""
  if (needsOwner(view)) return ""
  if (view.source === "full") return "Running. Update Olympus to see indexing progress and what needs you here."
  return view.attentionKnown ? "Everything is up to date." : "Running. Couldn't read what needs you; open the dashboard to check."
}
