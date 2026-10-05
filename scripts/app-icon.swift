// Draws the app icon — the R2FEL plate and HamLog on a dark tile — at any size.
// The tile has see-through corners (the old icon was a square with a dark
// frame round the tile, and looked cut out of its background).
//
//   swiftc -O scripts/app-icon.swift -o /tmp/app-icon
//   /tmp/app-icon out.png SIZE TILE SHADOW
//
// TILE is the tile's share of the square: 0.8047 — Apple's grid for Mac icons
// (824 of 1024, with a shadow: SHADOW 1); 0.94 — Windows (public/icons/app-icon-win.png);
// 1 — edge to edge, for the web icons (icon-180/192/512: phones round them off
// themselves). build/icon.icns: every size 16…1024 at 0.8047 into an .iconset,
// then `iconutil -c icns`. public/icons/app-icon.png: 1024 at 0.8047 (the dev
// copy's Dock icon).
import AppKit
let a = CommandLine.arguments
let out = a[1]; let S = CGFloat(Double(a[2])!); let frac = CGFloat(Double(a[3])!); let shadow = a[4] == "1"
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(S), pixelsHigh: Int(S), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
rep.size = NSSize(width: S, height: S)
NSGraphicsContext.saveGraphicsState()
let ctx = NSGraphicsContext(bitmapImageRep: rep)!
NSGraphicsContext.current = ctx
let cg = ctx.cgContext
cg.clear(CGRect(x: 0, y: 0, width: S, height: S))
// Flip to top-left origin.
cg.translateBy(x: 0, y: S); cg.scaleBy(x: 1, y: -1)
let srgb = CGColorSpace(name: CGColorSpace.sRGB)!
func col(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
  CGColor(colorSpace: srgb, components: [CGFloat((hex >> 16) & 255) / 255, CGFloat((hex >> 8) & 255) / 255, CGFloat(hex & 255) / 255, alpha])!
}
let full = frac >= 1
let T = S * frac                      // tile side
let o = (S - T) / 2                   // tile offset (Apple's grid: 824 of 1024 → frac 0.8047)
let tile = CGRect(x: o, y: o, width: T, height: T)
// macOS icon shape: a superellipse (n = 5), not a plain rounded rectangle.
func squircle(_ r: CGRect) -> CGPath {
  let p = CGMutablePath(); let n: CGFloat = 5
  let cx = r.midX, cy = r.midY, ax = r.width / 2, ay = r.height / 2
  for i in 0...720 {
    let t = CGFloat(i) / 720 * 2 * .pi
    let c = cos(t), s = sin(t)
    let x = cx + ax * (c < 0 ? -1 : 1) * pow(abs(c), 2 / n)
    let y = cy + ay * (s < 0 ? -1 : 1) * pow(abs(s), 2 / n)
    i == 0 ? p.move(to: CGPoint(x: x, y: y)) : p.addLine(to: CGPoint(x: x, y: y))
  }
  p.closeSubpath(); return p
}
let shape: CGPath = full ? CGPath(rect: tile, transform: nil) : squircle(tile)
if shadow && !full {
  cg.saveGState()
  cg.setShadow(offset: CGSize(width: 0, height: -T * 0.012), blur: T * 0.03, color: col(0x000000, 0.45))
  cg.addPath(shape); cg.setFillColor(col(0x2e2b24)); cg.fillPath()
  cg.restoreGState()
}
// Tile: a quiet top-to-bottom shade of the app's panel colour.
cg.saveGState()
cg.addPath(shape); cg.clip()
let grad = CGGradient(colorsSpace: srgb, colors: [col(0x37332b), col(0x28251f)] as CFArray, locations: [0, 1])!
cg.drawLinearGradient(grad, start: CGPoint(x: 0, y: tile.minY), end: CGPoint(x: 0, y: tile.maxY), options: [])
cg.restoreGState()
if !full {   // a hairline of light round the edge, as on the system's own icons
  cg.saveGState(); cg.addPath(shape); cg.clip()
  cg.addPath(shape); cg.setStrokeColor(col(0xffffff, 0.07)); cg.setLineWidth(T * 0.006); cg.strokePath()
  cg.restoreGState()
}
// ---- The mark ------------------------------------------------------------
// The program's own nameplate: the callsign on an amber plate, HamLog under
// it. Everything is a fraction of the artwork box, so it holds together at
// any size — and below 96 points the drawing gives up parts of itself rather
// than shrinking into mush: at 40…95 only the plate is left, under 40 the
// tile itself becomes the plate with R2 on it.
let A = (full ? T * 0.86 : T * 0.94)      // artwork box inside the tile
let ax = S / 2 - A / 2, ay = S / 2 - A / 2
let amber = col(0xe8a23d)
let ink = col(0x14130f)
let paper = col(0xece7d8)

func condensedFont(_ size: CGFloat) -> NSFont {
  // Barlow Condensed lives in the page as a webfont; the nearest thing the
  // system has is its own condensed face.
  if #available(macOS 13.0, *) {
    return NSFont.systemFont(ofSize: size, weight: .bold, width: .condensed)
  }
  return NSFont(name: "HelveticaNeue-CondensedBold", size: size)
    ?? NSFont.systemFont(ofSize: size, weight: .bold)
}

/// Draws one line of text centred on `cx`, sitting on `baseY`, measured by its
/// ink so the wordmark is optically centred rather than centred on its metrics.
func drawText(_ str: String, font: NSFont, color: CGColor, kern: CGFloat, cx: CGFloat, baseY: CGFloat) {
  let at = NSAttributedString(string: str, attributes: [
    .font: font, .foregroundColor: NSColor(cgColor: color)!, .kern: kern
  ])
  let line = CTLineCreateWithAttributedString(at)
  cg.saveGState()
  cg.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
  // Image bounds are measured from wherever the context's text position
  // happens to be, and that is not part of the saved state — so it goes back
  // to zero before measuring, or the second line lands a line's width away.
  cg.textPosition = .zero
  let b = CTLineGetImageBounds(line, cg)
  cg.textPosition = CGPoint(x: cx - b.width / 2 - b.minX, y: baseY)
  CTLineDraw(line, cg)
  cg.restoreGState()
}

func plate(_ r: CGRect, radius: CGFloat) {
  cg.addPath(CGPath(roundedRect: r, cornerWidth: radius, cornerHeight: radius, transform: nil))
  cg.setFillColor(amber); cg.fillPath()
}

if S < 40 {
  // Too small for words: the tile itself is the plate, with the first half of
  // the callsign on it. Anything more turns to porridge at 16 points.
  cg.addPath(shape); cg.setFillColor(amber); cg.fillPath()
  let f = NSFont.monospacedSystemFont(ofSize: T * 0.46, weight: .bold)
  drawText("R2", font: f, color: ink, kern: T * 0.02, cx: S / 2, baseY: S / 2 + T * 0.17)
} else if S < 96 {
  // Only the plate — five letters across the whole tile still read.
  let pw = A * 0.92, ph = A * 0.40
  plate(CGRect(x: ax + (A - pw) / 2, y: ay + (A - ph) / 2, width: pw, height: ph), radius: ph * 0.22)
  let f = NSFont.monospacedSystemFont(ofSize: ph * 0.58, weight: .bold)
  drawText("R2FEL", font: f, color: ink, kern: ph * 0.07, cx: S / 2, baseY: ay + A / 2 + ph * 0.20)
} else {
  // The whole mark.
  let pw = A * 0.78, ph = A * 0.25
  let px = ax + (A - pw) / 2, py = ay + A * 0.18
  plate(CGRect(x: px, y: py, width: pw, height: ph), radius: ph * 0.21)
  let fc = NSFont.monospacedSystemFont(ofSize: ph * 0.60, weight: .bold)
  drawText("R2FEL", font: fc, color: ink, kern: ph * 0.10, cx: S / 2, baseY: py + ph * 0.72)
  drawText("HamLog", font: condensedFont(A * 0.275), color: paper,
           kern: A * 0.012, cx: S / 2, baseY: ay + A * 0.80)
}
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
