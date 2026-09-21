// 本地 OCR（macOS Vision 框架，走 JXA 的 ObjC 桥）。零依赖、不联网。
// 视觉服务限流或不可用时，这是读截图文字的可靠出路。
//
//   osascript -l JavaScript scripts/ocr.js "$(pwd)/shot.png"
//
// 输出每行：[x<左> y<上> <宽>x<高>] <文字>
// 坐标是图片像素，可直接喂给 vision_crop / compose.mjs 做定位。
ObjC.import('Foundation'); ObjC.import('AppKit'); ObjC.import('ImageIO'); ObjC.import('Vision')
function run(argv){
  const url = $.NSURL.fileURLWithPath(argv[0])
  const src = $.CGImageSourceCreateWithURL(url, null)
  if (!src) return 'ERR: 读不到图片 ' + argv[0]
  const cg = $.CGImageSourceCreateImageAtIndex(src, 0, null)
  const W = $.CGImageGetWidth(cg), H = $.CGImageGetHeight(cg)
  const req = $.VNRecognizeTextRequest.alloc.init
  req.recognitionLevel = 0
  req.usesLanguageCorrection = false
  req.recognitionLanguages = ['zh-Hans', 'en-US']
  const handler = $.VNImageRequestHandler.alloc.initWithCGImageOptions(cg, $.NSDictionary.dictionary)
  const err = Ref()
  handler.performRequestsError($.NSArray.arrayWithObject(req), err)
  const obs = req.results
  if (!obs.js) return 'ERR ' + (err[0] ? ObjC.unwrap(err[0].localizedDescription) : '?')
  const rows = []
  for (let i = 0; i < obs.count; i++){
    const o = obs.objectAtIndex(i)
    const c = o.topCandidates(1).objectAtIndex(0)
    const b = o.boundingBox
    rows.push({
      x: Math.round(b.origin.x * W),
      y: Math.round((1 - b.origin.y - b.size.height) * H),
      w: Math.round(b.size.width * W),
      h: Math.round(b.size.height * H),
      t: ObjC.unwrap(c.string),
    })
  }
  rows.sort((a, b) => (Math.abs(a.y - b.y) > 12 ? a.y - b.y : a.x - b.x))
  return rows.map((r) => `[x${r.x} y${r.y} ${r.w}x${r.h}] ${r.t}`).join('\n')
}
