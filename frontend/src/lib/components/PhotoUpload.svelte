<script lang="ts">
  import { tr, locale } from '$lib/i18n.js';

  // Reusable photo picker. Reads a file, resizes it client-side to a small JPEG
  // (so the stored data: URI stays light), and hands the data URL to `onchange`.
  // Passing null (Remove) clears it. Shows initials when there's no photo.
  let { photo = null, name = '', shape = 'circle', size = 96, onchange, onexpand }:
    { photo?: string | null; name?: string; shape?: 'circle' | 'square'; size?: number; onchange: (dataUrl: string | null) => void | Promise<void>; onexpand?: () => void } = $props();

  let busy = $state(false);
  let fileInput: HTMLInputElement;
  const initials = $derived((name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('') || '?');
  const radius = $derived(shape === 'circle' ? 'rounded-full' : 'rounded-2xl');

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
    busy = true;
    try { await onchange(await resize(file, 512)); }
    catch (err) { alert((err as Error).message); }
    finally { busy = false; input.value = ''; }
  }
  async function remove() { busy = true; try { await onchange(null); } finally { busy = false; } }
</script>

<div class="flex items-center gap-4">
  {#if photo && onexpand}
    <button type="button" onclick={onexpand} class="{radius} cursor-zoom-in overflow-hidden ring-2 ring-slate-200 transition hover:ring-primary-400 dark:ring-slate-700" style="width:{size}px;height:{size}px" title={tr({ en: 'Click to enlarge', ar: 'اضغط للتكبير' }, $locale)} aria-label={tr({ en: 'Enlarge photo', ar: 'تكبير الصورة' }, $locale)}>
      <img src={photo} alt={name} class="h-full w-full object-cover" />
    </button>
  {:else if photo}
    <img src={photo} alt={name} class="{radius} object-cover ring-2 ring-slate-200 dark:ring-slate-700" style="width:{size}px;height:{size}px" />
  {:else}
    <div class="grid shrink-0 place-items-center {radius} bg-gradient-to-br from-slate-200 to-slate-300 font-semibold text-slate-500 dark:from-slate-700 dark:to-slate-800 dark:text-slate-300" style="width:{size}px;height:{size}px;font-size:{Math.round(size / 3)}px">{initials}</div>
  {/if}
  <div class="flex flex-col items-start gap-1.5">
    <button type="button" class="btn-ghost border border-slate-300 text-sm dark:border-slate-700" onclick={() => fileInput?.click()} disabled={busy}>
      📷 {busy ? tr({ en: 'Saving…', ar: 'جارٍ الحفظ…' }, $locale) : (photo ? tr({ en: 'Change photo', ar: 'تغيير الصورة' }, $locale) : tr({ en: 'Add photo', ar: 'إضافة صورة' }, $locale))}
    </button>
    {#if photo}<button type="button" class="text-xs text-rose-600 hover:underline dark:text-rose-400" onclick={remove} disabled={busy}>{tr({ en: 'Remove', ar: 'إزالة' }, $locale)}</button>{/if}
    <input bind:this={fileInput} type="file" accept="image/*" class="hidden" onchange={onFile} />
  </div>
</div>
