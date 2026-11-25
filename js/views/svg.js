/** Small helpers shared by the view builders. */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Creates an SVG element with attributes. */
export function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'text') node.textContent = value;
    else node.setAttribute(key, String(value));
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

/** Hour (0–23) of a local ISO time like "2026-11-25T07:00". */
export const hourOf = (iso) => Number.parseInt(iso.slice(11, 13), 10);
