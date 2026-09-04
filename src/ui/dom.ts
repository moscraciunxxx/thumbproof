/** Tiny DOM helpers. Kept deliberately small — no framework, no runtime deps. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else n.setAttribute(k, v);
  }
  for (const c of children) n.append(c);
  return n;
}

export function mustGet<T extends HTMLElement>(id: string): T {
  const n = document.getElementById(id);
  if (!n) throw new Error(`Missing #${id} in the document`);
  return n as T;
}

/**
 * Empty a container, explicitly releasing any canvas backing stores inside it.
 *
 * Removing a <canvas> from the DOM does not free its pixels until GC runs, and
 * WebKit budgets TOTAL canvas area per page rather than per element. Re-rendering
 * the wall (five tiles) plus a 1280x720 diagnostic on every analysis will blow that
 * budget on iOS and Safari, at which point canvases silently stop painting.
 * Setting the dimensions to zero drops the backing store immediately.
 */
export function clear(n: HTMLElement): HTMLElement {
  for (const c of n.querySelectorAll('canvas')) {
    c.width = 0;
    c.height = 0;
  }
  while (n.firstChild) n.firstChild.remove();
  return n;
}
