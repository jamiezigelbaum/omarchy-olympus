import QtQuick
import QtQuick.Controls
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Status.js" as Status

// Olympus in the Omarchy bar: the mountain mark plus a few plain words
// (Ready, Indexing 42%, Needs you, Stopped), and a panel with the detail and
// an Open dashboard button.
//
// Everything comes from the olympus CLI the owner already has. The widget
// never reads Olympus's files, sockets or secrets itself, and it keeps only
// the parsed state in memory: no output is logged or written anywhere.
Panel {
  id: root
  moduleName: "jamiezigelbaum.olympus"
  ipcTarget: "jamiezigelbaum.olympus"
  manageIpc: false

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color urgent: bar ? bar.urgent : Color.urgent
  readonly property color dim: Qt.darker(foreground, 1.55)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  readonly property int refreshIntervalSec: intSetting("refreshIntervalSec", 60, 15, 3600)
  readonly property bool showLabel: setting("showLabel", true) !== false
  readonly property string olympusPath: expandHome(String(setting("olympusPath", "") || "~/.local/bin/olympus"))

  // The last parsed view (see Status.js); null until the first check lands.
  property var view: null
  property double checkedAt: 0
  property bool briefUnsupported: false
  property string actionStatus: ""
  property bool cursorActive: false
  // Set while the watchdog stops a hung check, so its exit is not read as an answer.
  property bool abandoning: false
  property bool dashboardAbandoned: false

  readonly property string label: Status.barLabel(view)
  readonly property string barText: showLabel ? Status.barText(view) : ""
  readonly property string tone: Status.barTone(view)
  readonly property string progressText: view ? Status.progressLine(view.progress) : ""
  readonly property string summaryText: Status.summaryLine(view)
  readonly property bool checking: briefProcess.running || fullProcess.running
  readonly property var needsYou: view ? view.needsYou : []
  readonly property int needsYouCount: view ? view.needsYouCount : 0
  readonly property string blocker: view ? view.blocker : ""

  function intSetting(name, fallback, min, max) {
    var n = parseInt(String(setting(name, fallback)), 10)
    if (!isFinite(n)) n = fallback
    return Math.max(min, Math.min(max, n))
  }

  function expandHome(path) {
    var home = Quickshell.env("HOME") || ""
    if (path === "~") return home
    return path.indexOf("~/") === 0 ? home + path.substring(1) : path
  }

  function refresh() {
    if (checking) return
    if (briefUnsupported) fullProcess.running = true
    else briefProcess.running = true
    watchdog.restart()
  }

  function apply(nextView) {
    view = nextView
    checkedAt = Date.now()
    watchdog.stop()
  }

  function openDashboard() {
    if (dashboardProcess.running) return
    actionStatus = "Opening the dashboard…"
    dashboardProcess.running = true
    dashboardWatchdog.restart()
  }

  function checkedText() {
    if (!(checkedAt > 0)) return ""
    return "Checked at " + Qt.formatTime(new Date(checkedAt), "HH:mm")
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  onOpenedChanged: if (opened) {
    cursorActive = false
    // A panel open is the cheap moment to notice an Olympus update that
    // added --brief.
    briefUnsupported = false
    refresh()
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  IpcHandler {
    target: root.ipcTarget
    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.toggle() }
    function refresh(): string { root.refresh(); return "ok" }
    function status(): string { return root.label }
  }

  // `olympus engine status --brief`: state, progress and Needs you in the
  // dashboard's own words. Its stdout is parsed whatever the exit code, since
  // a stopped engine is still a valid answer.
  Process {
    id: briefProcess
    running: false
    // stderr is dropped here, before Quickshell sees it: output a Process does
    // not collect is not discarded but passed on to the shell's own log.
    command: ["sh", "-c", 'exec "$0" engine status --brief 2>/dev/null', root.olympusPath]
    stdout: StdioCollector { id: briefOut; waitForEnd: true }
    onExited: function(exitCode) {
      if (root.abandoning) { root.abandoning = fullProcess.running; return }
      var parsed = Status.fromBrief(briefOut.text)
      if (parsed) { root.apply(parsed); return }
      // An engine older than --brief rejects the flag: fall back to the full
      // report, which knows running and stopped but not progress.
      root.briefUnsupported = true
      fullProcess.running = true
      watchdog.restart()
    }
  }

  Process {
    id: fullProcess
    running: false
    command: ["sh", "-c", 'exec "$0" engine status 2>/dev/null', root.olympusPath]
    stdout: StdioCollector { id: fullOut; waitForEnd: true }
    onExited: function(exitCode) {
      if (root.abandoning) { root.abandoning = briefProcess.running; return }
      var parsed = Status.fromFullStatus(fullOut.text)
      root.apply(parsed || Status.unavailable("Couldn't run " + root.olympusPath + ". Is Olympus installed for this account?"))
    }
  }

  // `olympus dashboard` prints the private owner link. Both streams go to
  // /dev/null inside sh, so the link never reaches the shell's memory or log.
  Process {
    id: dashboardProcess
    running: false
    command: ["sh", "-c", 'exec "$0" dashboard >/dev/null 2>&1', root.olympusPath]
    onExited: function(exitCode) {
      dashboardWatchdog.stop()
      if (root.dashboardAbandoned) {
        root.dashboardAbandoned = false
        return
      }
      if (exitCode === 0) {
        root.actionStatus = ""
        root.close()
      } else {
        root.actionStatus = "The dashboard didn't open. Run olympus dashboard in a terminal to see why."
      }
    }
  }

  Timer {
    interval: root.refreshIntervalSec * 1000
    repeat: true
    running: true
    triggeredOnStart: true
    onTriggered: root.refresh()
  }

  // While the engine is starting, look again every 10 seconds so the bar
  // settles soon after it is up.
  Timer {
    interval: 10000
    repeat: true
    running: !!root.view && root.view.state === "starting"
    onTriggered: root.refresh()
  }

  // A CLI that hangs must not stop every later check.
  Timer {
    id: watchdog
    interval: 20000
    repeat: false
    onTriggered: {
      root.abandoning = briefProcess.running || fullProcess.running
      briefProcess.running = false
      fullProcess.running = false
      root.apply(Status.unavailable("Olympus didn't answer in time."))
    }
  }

  // A browser launcher that never returns must not leave the button disabled.
  Timer {
    id: dashboardWatchdog
    interval: 30000
    repeat: false
    onTriggered: {
      if (!dashboardProcess.running) return
      root.dashboardAbandoned = true
      dashboardProcess.running = false
      root.actionStatus = "The dashboard didn't open in time. Run olympus dashboard in a terminal to see why."
    }
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    labelVisible: false
    hasVisualContent: true
    fixedWidth: vertical ? -1 : (labelText.visible ? content.implicitWidth + scaledHorizontalMargin * 2 : Style.bar.iconSlot)
    fixedHeight: vertical ? Style.bar.iconSlot : -1
    tooltipText: labelText.visible ? "" : "Olympus: " + root.label

    readonly property color toneColor: root.tone === "urgent"
      ? (root.bar ? root.bar.urgent : Color.urgent)
      : (root.tone === "dim" ? Qt.darker(button.foreground, 1.55) : button.foreground)

    Row {
      id: content
      anchors.centerIn: parent
      spacing: Style.space(6)

      OlympusMark {
        anchors.verticalCenter: parent.verticalCenter
        iconSize: Style.space(12)
        color: button.toneColor
      }

      Text {
        id: labelText
        anchors.verticalCenter: parent.verticalCenter
        visible: root.barText !== "" && !button.vertical
        text: root.barText
        color: button.toneColor
        font.family: button.fontFamily
        font.pixelSize: Style.font.body
        renderType: Text.NativeRendering
      }
    }

    onPressed: function(code) {
      if (code === Qt.RightButton) root.openDashboard()
      else if (code === Qt.MiddleButton) root.refresh()
      else root.toggle()
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(340))
    contentHeight: panel.fittedContentHeight(column.implicitHeight, Style.space(480))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onMoveRequested: function(dx, dy) { root.cursorActive = true }
      onActivateRequested: root.openDashboard()
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(t) {
        if (t === "r" || t === "R") root.refresh()
        else if (t === "d" || t === "D") root.openDashboard()
      }

      Flickable {
        id: panelFlick
        anchors.fill: parent
        contentWidth: width
        contentHeight: column.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        interactive: contentHeight > height
        ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

        Column {
          id: column
          width: panelFlick.width
          spacing: Style.space(12)

          PanelHero {
            width: parent.width
            title: "Olympus"
            meta: root.checking && !root.view ? "Checking" : Status.stateWord(root.view)
            foreground: root.foreground
            fontFamily: root.fontFamily
            iconOpacity: root.tone === "dim" ? 0.5 : 1.0
            iconComponent: Component {
              OlympusMark {
                iconSize: Style.font.display
                color: root.tone === "urgent" ? root.urgent : root.foreground
              }
            }
          }

          BodyText {
            visible: text !== ""
            text: root.progressText
            color: root.foreground
          }

          BodyText {
            visible: text !== ""
            text: root.summaryText
            color: root.dim
          }

          Column {
            visible: root.needsYouCount > 0 || root.blocker !== ""
            width: parent.width
            spacing: Style.space(6)

            PanelSectionHeader {
              text: root.needsYouCount > 0 ? "NEEDS YOU (" + root.needsYouCount + ")" : "NEEDS YOU"
              foreground: root.urgent
              fontFamily: root.fontFamily
            }

            BodyText {
              visible: root.blocker !== ""
              text: root.blocker
              color: root.urgent
            }

            Repeater {
              model: root.needsYou
              BodyText {
                required property var modelData
                text: "• " + modelData
                color: root.foreground
              }
            }

            BodyText {
              visible: root.needsYouCount > root.needsYou.length
              text: "and " + (root.needsYouCount - root.needsYou.length) + " more in the dashboard"
              color: root.dim
            }
          }

          Button {
            width: parent.width
            text: "Open dashboard"
            iconText: "󰖟"
            foreground: root.foreground
            fontFamily: root.fontFamily
            bordered: true
            hasCursor: root.cursorActive
            enabled: !dashboardProcess.running && !!root.view && root.view.state !== "not_installed"
            onClicked: root.openDashboard()
            onHovered: function(h) { if (h) root.cursorActive = true }
          }

          BodyText {
            visible: text !== ""
            text: root.actionStatus
            color: root.dim
          }

          Text {
            width: parent.width
            text: root.checkedText()
            visible: text !== ""
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            horizontalAlignment: Text.AlignRight
          }
        }
      }
    }
  }

  component BodyText: Text {
    width: parent ? parent.width : implicitWidth
    font.family: root.fontFamily
    font.pixelSize: Style.font.body
    wrapMode: Text.WordWrap
  }
}
