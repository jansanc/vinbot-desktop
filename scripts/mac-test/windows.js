ObjC.import("CoreGraphics");
ObjC.import("Foundation");
const list = ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, 0));
const out = [];
for (let i = 0; i < list.count; i++) {
  const w = ObjC.deepUnwrap(list.objectAtIndex(i));
  if (/firefox|vinbot|electron/i.test(w.kCGWindowOwnerName)) out.push(`${w.kCGWindowOwnerName} pid=${w.kCGWindowOwnerPID} layer=${w.kCGWindowLayer} name=${w.kCGWindowName || ""} ${JSON.stringify(w.kCGWindowBounds)}`);
}
out.length ? out.join("\n") : "(no Firefox/Vinbot windows on screen)";
