function restoreBounds(saved, displays, compact = false) {
  if (!saved || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(saved[key])) || saved.width <= 0 || saved.height <= 0) saved = null;
  const area = displays.find(d => saved && saved.x < d.x + d.width && saved.x + saved.width > d.x
    && saved.y < d.y + d.height && saved.y + saved.height > d.y) || displays[0];
  const width = Math.min(area.width, Math.max(360, Math.min(640, saved?.width || 420)));
  const height = compact ? 200 : Math.min(area.height, Math.max(460, Math.min(900, saved?.height || 540)));
  return {
    x: Math.round(Math.max(area.x, Math.min(area.x + area.width - width, saved?.x ?? area.x + area.width - width - 24))),
    y: Math.round(Math.max(area.y, Math.min(area.y + area.height - height, saved?.y ?? area.y + 40))),
    width: Math.round(width), height: Math.round(height),
  };
}
function snapToBounds(bounds, workArea, snapThreshold = 24) {
  if (!bounds || !workArea) return bounds;
  let { x, y, width, height } = bounds;

  // Snap left
  if (Math.abs(x - workArea.x) < snapThreshold) {
    x = workArea.x;
  }
  // Snap right
  else if (Math.abs((x + width) - (workArea.x + workArea.width)) < snapThreshold) {
    x = workArea.x + workArea.width - width;
  }

  // Snap top
  if (Math.abs(y - workArea.y) < snapThreshold) {
    y = workArea.y;
  }
  // Snap bottom
  else if (Math.abs((y + height) - (workArea.y + workArea.height)) < snapThreshold) {
    y = workArea.y + workArea.height - height;
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

module.exports = { restoreBounds, snapToBounds };
