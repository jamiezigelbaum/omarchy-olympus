import QtQuick
import QtQuick.Shapes

// The Olympus mountain (site/favicon.svg in the Olympus repo), drawn as a
// theme-coloured shape so it follows the bar's colours like the built-in icons.
Item {
  id: root

  property real iconSize: 14
  property color color: "white"

  // The mark spans 28 × 18 units of the favicon's 32-unit box.
  implicitWidth: iconSize * 1.4
  implicitHeight: iconSize * 0.9
  width: implicitWidth
  height: implicitHeight

  Shape {
    anchors.fill: parent
    antialiasing: true
    layer.enabled: true
    layer.samples: 4

    ShapePath {
      fillColor: root.color
      strokeWidth: 0
      startX: 0; startY: root.height
      PathLine { x: root.width * 0.375; y: 0 }
      PathLine { x: root.width * 0.525; y: root.height * 0.4 }
      PathLine { x: root.width * 0.643; y: root.height * 0.111 }
      PathLine { x: root.width; y: root.height }
      PathLine { x: 0; y: root.height }
    }
  }
}
