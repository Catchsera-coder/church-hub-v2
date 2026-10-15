<script lang="ts">
  import { tr, locale } from '$lib/i18n.js';

  // A click-only, Word-style rich-text editor (contenteditable). The user sees the
  // styling live — no symbols. Output is HTML, sanitised on the server before it is
  // ever stored or sent. Used for the email body; SMS/WhatsApp use a plain textarea.
  let {
    value = $bindable(),
    dir = 'ltr',
    minHeight = 160,
    onpolish = undefined,
  }: {
    value?: string;
    dir?: string;
    minHeight?: number;
    onpolish?: ((html: string) => Promise<string>) | undefined;
  } = $props();

  let el = $state<HTMLDivElement | null>(null);
  let polishing = $state(false);
  let polishError = $state('');
  let showColors = $state(false);
  let ready = $state(false);

  // Named colours (brand-safe palette) + a free picker.
  const COLORS = ['#0f172a', '#dc2626', '#ea580c', '#d97706', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#db2777', '#64748b', '#ffffff'];

  $effect(() => {
    // Initialise once, and re-sync when the value is replaced from OUTSIDE (AI
    // polish, template prefill) — but never while the user is typing in it.
    if (!el) return;
    const v = value ?? '';
    if (!ready) { el.innerHTML = v; ready = true; return; }
    if (document.activeElement !== el && el.innerHTML !== v) el.innerHTML = v;
  });

  function sync() { if (el) value = el.innerHTML; }

  function exec(cmd: string, arg?: string) {
    if (!el) return;
    el.focus();
    try { document.execCommand('styleWithCSS', false, 'true'); } catch { /* not all browsers */ }
    try { document.execCommand(cmd, false, arg); } catch { /* ignore */ }
    sync();
  }
  function heading(tag: 'H2' | 'H3' | 'P') { exec('formatBlock', tag); }
  function color(c: string) { exec('foreColor', c); showColors = false; }
  function addLink() {
    const url = prompt(tr({ en: 'Link URL (https://…)', ar: 'رابط (https://…)' }, $locale));
    if (url) exec('createLink', /^https?:\/\//i.test(url) ? url : `https://${url}`);
  }

  async function polish() {
    if (!onpolish || !(value ?? '').trim()) return;
    polishing = true; polishError = '';
    try { const out = await onpolish(value ?? ''); value = out; if (el) el.innerHTML = out; }
    catch (err) { polishError = (err as Error).message; }
    finally { polishing = false; }
  }

  const btn = 'rounded-md px-2 py-1 text-sm font-medium text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-700';
</script>

<div class="rounded-lg border border-slate-300 dark:border-slate-700">
  <div class="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-slate-100 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-800">
    <button type="button" class="{btn} font-bold" title={tr({ en: 'Bold', ar: 'عريض' }, $locale)} onclick={() => exec('bold')}>B</button>
    <button type="button" class="{btn} italic" title={tr({ en: 'Italic', ar: 'مائل' }, $locale)} onclick={() => exec('italic')}>I</button>
    <button type="button" class="{btn} underline" title={tr({ en: 'Underline', ar: 'تسطير' }, $locale)} onclick={() => exec('underline')}>U</button>
    <span class="mx-1 h-5 w-px bg-slate-300 dark:bg-slate-600"></span>
    <div class="relative">
      <button type="button" class={btn} title={tr({ en: 'Text colour', ar: 'لون النص' }, $locale)} onclick={() => (showColors = !showColors)}>🎨</button>
      {#if showColors}
        <div class="absolute z-30 mt-1 w-44 rounded-lg border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <div class="grid grid-cols-6 gap-1">
            {#each COLORS as c}
              <button type="button" class="h-6 w-6 rounded border border-slate-200 dark:border-slate-600" style="background:{c}" title={c} aria-label={c} onclick={() => color(c)}></button>
            {/each}
          </div>
          <label class="mt-2 flex items-center gap-2 text-xs text-slate-500">
            {tr({ en: 'Custom', ar: 'مخصص' }, $locale)}
            <input type="color" class="h-6 w-8 cursor-pointer border-0 bg-transparent p-0" oninput={(e) => color((e.currentTarget as HTMLInputElement).value)} />
          </label>
        </div>
      {/if}
    </div>
    <span class="mx-1 h-5 w-px bg-slate-300 dark:bg-slate-600"></span>
    <button type="button" class={btn} title={tr({ en: 'Big heading', ar: 'عنوان كبير' }, $locale)} onclick={() => heading('H2')}>H<span class="text-base">+</span></button>
    <button type="button" class={btn} title={tr({ en: 'Small heading', ar: 'عنوان صغير' }, $locale)} onclick={() => heading('H3')}>h<span class="text-xs">+</span></button>
    <button type="button" class={btn} title={tr({ en: 'Normal text', ar: 'نص عادي' }, $locale)} onclick={() => heading('P')}>¶</button>
    <span class="mx-1 h-5 w-px bg-slate-300 dark:bg-slate-600"></span>
    <button type="button" class={btn} title={tr({ en: 'Bullet list', ar: 'قائمة نقطية' }, $locale)} onclick={() => exec('insertUnorderedList')}>• ▤</button>
    <button type="button" class={btn} title={tr({ en: 'Numbered list', ar: 'قائمة مرقمة' }, $locale)} onclick={() => exec('insertOrderedList')}>1. ▤</button>
    <button type="button" class={btn} title={tr({ en: 'Link', ar: 'رابط' }, $locale)} onclick={addLink}>🔗</button>
    <button type="button" class={btn} title={tr({ en: 'Clear formatting', ar: 'إزالة التنسيق' }, $locale)} onclick={() => exec('removeFormat')}>✕ᴬ</button>
    {#if onpolish}
      <button type="button" class="ms-auto rounded-md px-2.5 py-1 text-sm font-semibold text-white disabled:opacity-50" style="background: var(--brand)" disabled={polishing || !(value ?? '').trim()} onclick={polish}>{polishing ? tr({ en: '✨ Polishing…', ar: '✨ جارٍ التنسيق…' }, $locale) : tr({ en: '✨ Polish with AI', ar: '✨ نسّق بالذكاء الاصطناعي' }, $locale)}</button>
    {/if}
  </div>
  <div
    bind:this={el}
    contenteditable="true"
    role="textbox"
    tabindex="0"
    aria-multiline="true"
    dir={dir as 'ltr' | 'rtl' | 'auto'}
    class="ch-rich px-3 py-2 text-sm leading-relaxed focus:outline-none"
    style="min-height:{minHeight}px"
    oninput={sync}
    onblur={sync}
  ></div>
</div>
{#if polishError}<p class="mt-1 text-xs text-rose-600 dark:text-rose-400">{polishError}</p>{/if}

<style>
  .ch-rich :global(h2) { font-size: 1.25rem; font-weight: 700; margin: 0.4em 0 0.3em; }
  .ch-rich :global(h3) { font-size: 1.1rem; font-weight: 700; margin: 0.4em 0 0.3em; }
  .ch-rich :global(ul) { list-style: disc; padding-inline-start: 1.4em; margin: 0.3em 0; }
  .ch-rich :global(ol) { list-style: decimal; padding-inline-start: 1.4em; margin: 0.3em 0; }
  .ch-rich :global(a) { color: var(--brand); text-decoration: underline; }
  .ch-rich:empty::before { content: attr(data-placeholder); color: #94a3b8; }
</style>
