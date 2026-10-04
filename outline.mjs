// Preserve explicit PDF bookmark trees; infer missing hierarchy among siblings.
export function sectionNumber(title = '') {
  const match = title.trim().match(/^(?:chapter\s+|第\s*)?(\d+(?:\.\d+)*)(?=\s|[章:：、.]|$)/i);
  return match?.[1] || null;
}
export function groupOutline(items = []) {
  const roots = [], stack = [];
  for (const original of items) {
    const node = {...original, items: groupOutline(original.items || [])};
    const number = sectionNumber(node.title);
    if (!number) { stack.length = 0; roots.push(node); continue; }
    while (stack.length && !number.startsWith(stack.at(-1).number + '.')) stack.pop();
    if (stack.length) stack.at(-1).node.items.push(node);
    else roots.push(node);
    stack.push({number, node});
  }
  return roots;
}
