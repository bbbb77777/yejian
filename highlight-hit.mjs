export function findHighlightAt(annotations, page, x, y) {
  return annotations.find(item => item.type === 'highlight' && item.page === page && (item.rects || []).some(r => x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height));
}
