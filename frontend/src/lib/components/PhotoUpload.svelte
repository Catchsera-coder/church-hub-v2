<script lang="ts">
  import { tr, locale } from '$lib/i18n.js';

  // Reusable photo picker. Reads a file, resizes it client-side to a small JPEG
  // (so the stored data: URI stays light), and hands the data URL to `onchange`.
  // Compact by design: the avatar is the whole control; a small camera badge in
  // the corner opens Add (no photo) or a Change/Remove menu (has photo), so the
  // controls never dwarf the picture. Clicking the avatar enlarges it when the
  // caller passes `onexpand`.
  let { photo = null, name = '', shape = 'circle', size = 96, onchange, onexpand }:
    { photo?: string | null; name?: string; shape?: 'circle' | 'square'; size?: number; onchange: (dataUrl: string | null) => void | Promise<void>; onexpand?: () => void } = $props();

  let busy = $state(false);
  let menuOpen = $state(false);
  let fileInput: HTMLInputElement;
  const initials = $derived((name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('') || '?');
  const radius = $derived(shape === 'circle' ? 'rounded-full' : 'rounded-2xl');
  const badge = $derived(Math.max(22, Math.round(size * 0.3)));

  const L = {
    add: () => tr({ en: 'Add photo', ar: 'إضافة صورة' }, $locale),
    change: () => tr({ en: 'Change photo', ar: 'تغيير الصورة' }, $locale),
    enlarge: () => tr({ en: 'Enlarge', ar: 'تكبير' }, $locale),
    remove: () => tr({ en: 'Remove photo', ar: 'إزالة الصورة' }, $locale),
  };

  function resize(file: File, max: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      const img = new Image();
      reader.onerror = () => reject(new Error('Could not read that file.'));
      reader.onload = () => { img.src = reader.result as string; };
      img.onerror = () => reject(new Error('That file is not a valid image.'));
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Image processing is unavailable in this browser.'));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      reader.readAsDataURL(file);
    });
  }
  async function onFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    menuOpen = false; busy = true;
    try { await onchange(await resize(file, 512)); }
    catch (err) { alert((err as Error).message); }
    finally { busy = false; input.value = ''; }
  }
  async function remove() { menuOpen = false; busy = true; try { await onchange(null); } finally { busy = false; } }
  function pick() { menuOpen = false; fileInput?.click(); }
  function onAvatar() {
    if (busy) return;
    if (photo && onexpand) onexpand();
    else if (!photo) pick();
    else menuOpen = !menuOpen;
  }
</script>

<div class="relative inline-block align-middle" style="width:{size}px;height:{size}px">
  <button
    type="button"
    onclick={onAvatar}
    disabled={busy}
    class="group block h-full w-full {radius} overflow-hidden ring-2 ring-slate-200 transition dark:ring-slate-700 {photo && onexpand ? 'cursor-zoom-in hover:ring-primary-400' : 'cursor-pointer hover:ring-primary-400'}"
    title={photo ? (onexpand ? L.enlarge() : L.change()) : L.add()}
    aria-label={photo ? (onexpand ? L.enlarge() : L.change()) : L.add()}
  >
    {#if photo}
      <img src={photo} alt={name} class="h-full w-full object-cover" />
    {:else}
      <span class="grid h-full w-full place-items-center bg-gradient-to-br from-slate-200 to-slate-300 font-semibold text-slate-500 dark:from-slate-700 dark:to-slate-800 dark:text-slate-300" style="font-size:{Math.round(size / 3)}px">{initials}</span>
    {/if}
  </button>

  <!-- Corner camera badge: Add (no photo) or open the Change/Remove menu. -->
  <button
    type="button"
    onclick={() => (busy ? null : photo ? (menuOpen = !menuOpen) : pick())}
    disabled={busy}
    class="absolute -bottom-1 grid place-items-center rounded-full border-2 border-white bg-slate-800 text-white shadow-md transition hover:bg-slate-700 disabled:opacity-60 dark:border-slate-900 {$locale === 'ar' ? '-left-1' : '-right-1'}"
    style="width:{badge}px;height:{badge}px;font-size:{Math.round(badge * 0.5)}px"
    title={photo ? L.change() : L.add()}
    aria-label={photo ? L.change() : L.add()}
  >
    {busy ? '⏳' : '📷'}
  </button>

  {#if menuOpen && photo}
    <div class="fixed inset-0 z-40" role="presentation" onclick={() => (menuOpen = false)}></div>
    <div class="absolute top-full z-50 mt-1.5 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900 {$locale === 'ar' ? 'start-0' : 'end-0'}">
      <button type="button" class="block w-full px-3 py-2.5 text-start hover:bg-slate-100 dark:hover:bg-slate-800" onclick={pick}>📷 {L.change()}</button>
      {#if onexpand}<button type="button" class="block w-full px-3 py-2.5 text-start hover:bg-slate-100 dark:hover:bg-slate-800" onclick={() => { menuOpen = false; onexpand?.(); }}>🔍 {L.enlarge()}</button>{/if}
      <button type="button" class="block w-full px-3 py-2.5 text-start text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/30" onclick={remove}>🗑 {L.remove()}</button>
    </div>
  {/if}

  <input bind:this={fileInput} type="file" accept="image/*" class="hidden" onchange={onFile} />
</div>
