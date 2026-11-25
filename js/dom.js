/**
 * Tiny DOM helpers. Text is always set with textContent, never innerHTML,
 * so data from APIs or the AI model can never be parsed as markup.
 */

/** querySelector shorthand. */
export const $ = (selector, root = document) => root.querySelector(selector);

/**
 * Creates an element.
 * @param {string} tag
 * @param {{text?:string, class?:string, dataset?:object, [attr:string]:any}} props
 * @param {Node|string|Array<Node|string|null|undefined>} children
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'text') node.textContent = value;
    else if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child !== null && child !== undefined) node.append(child);
  }
  return node;
}

/** True when the user asked the OS for less motion. */
export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
