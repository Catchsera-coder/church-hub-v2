// Svelte action: call the handler when a pointerdown happens outside the element.
// Used to dismiss search-result dropdowns when the user clicks elsewhere.
export function clickOutside(node: HTMLElement, handler: () => void) {
  let current = handler;
  function onDown(e: MouseEvent) {
    if (!node.contains(e.target as Node)) current();
  }
  document.addEventListener('pointerdown', onDown, true);
  return {
    update(next: () => void) { current = next; },
    destroy() { document.removeEventListener('pointerdown', onDown, true); },
  };
}
