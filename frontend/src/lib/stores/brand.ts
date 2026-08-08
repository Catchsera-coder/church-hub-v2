// Apply the church's brand colour at runtime by overriding the --brand CSS var
// (defined in app.css). Null/invalid resets to the built-in palette default.
const HEX = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function applyBrandColor(color: string | null | undefined): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (color && HEX.test(color)) root.style.setProperty('--brand', color);
  else root.style.removeProperty('--brand');
}
