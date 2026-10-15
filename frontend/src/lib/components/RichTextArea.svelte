<script lang="ts">
  import { tr, locale } from '$lib/i18n.js';

  // A plain textarea with an optional light-formatting toolbar (markdown) and an
  // optional one-click "Polish with AI" button. The stored value is plain text
  // with simple markers (**bold**, *italic*, ## heading, - list) that the email
  // renderer turns into safe, styled HTML. SMS/WhatsApp just show the plain text.
  let {
    value = $bindable(''),
    dir = 'ltr',
    rows = 5,
    required = false,
    format = false,
    onpolish = undefined,
  }: {
    value?: string;
    dir?: string;
    rows?: number;
    required?: boolean;
    format?: boolean;
    onpolish?: ((text: string) => Promise<string>) | undefined;
  } = $props();

  let el = $state<HTMLTextAreaElement | null>(null);
  let polishing = $state(false);
  let polishError = $state('');

  function apply(fn: (v: string, start: number, end: number) => { v: string; selStart: number; selEnd: number }) {
    const ta = el; if (!ta) return;
    const cur = value ?? '';
    const start = ta.selectionStart ?? cur.length;
    const end = ta.selectionEnd ?? cur.length;
    const r = fn(cur, start, end);
    value = r.v;
    // Restore focus + selection after Svelte updates the DOM.
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(r.selStart, r.selEnd); });
  }

  // Wrap the current selection with marker chars (e.g. ** … **). With no
  // selection, insert the markers with the caret between them.
  function wrap(mark: string, placeholder: string) {
    apply((v, s, e) => {
      const sel = v.slice(s, e) || placeholder;
      const v2 = v.slice(0, s) + mark + sel + mark + v.slice(e);
      return { v: v2, selStart: s + mark.length, selEnd: s + mark.length + sel.length };
    });
  }

  // Add a prefix (e.g. "## ", "- ", "1. ") at the start of each selected line.
  function linePrefix(prefix: string, placeholder: string) {
    apply((v, s, e) => {
      const lineStart = v.lastIndexOf('\n', s - 1) + 1;
      const seg = v.slice(lineStart, e) || placeholder;
      const prefixed = seg.split('\n').map((ln, i) => (prefix === '1. ' ? `${i + 1}. ` : prefix) + ln).join('\n');
      const v2 = v.slice(0, lineStart) + prefixed + v.slice(e);
      return { v: v2, selStart: lineStart, selEnd: lineStart + prefixed.length };
    });
  }

  function insertLink() {
    apply((v, s, e) => {
      const label = v.slice(s, e) || tr({ en: 'link text', ar: 'نص الرابط' }, $locale);
      const snippet = `[${label}](https://)`;
      const v2 = v.slice(0, s) + snippet + v.slice(e);
      // Put the caret inside the (https://) so they can paste the URL.
      const urlPos = s + label.length + 3 + 8; // [label]( + https://
      return { v: v2, selStart: urlPos, selEnd: urlPos };
    });
  }

  async function polish() {
    if (!onpolish || !(value ?? '').trim()) return;
    polishing = true; polishError = '';
    try { value = await onpolish(value); }
    catch (err) { polishError = (err as Error).message; }
    finally { polishing = false; }
  }

  const btn = 'rounded-md px-2 py-1 text-sm font-medium text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-700';
</script>

{#if format}
  <div class="flex flex-wrap items-center gap-1 rounded-t-lg border border-b-0 border-slate-300 bg-slate-100 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-800">
    <button type="button" class="{btn} font-bold" title={tr({ en: 'Bold', ar: 'عريض' }, $locale)} onclick={() => wrap('**', tr({ en: 'bold text', ar: 'نص عريض' }, $locale))}>B</button>
    <button type="button" class="{btn} italic" title={tr({ en: 'Italic', ar: 'مائل' }, $locale)} onclick={() => wrap('*', tr({ en: 'italic text', ar: 'نص مائل' }, $locale))}>I</button>
    <span class="mx-1 h-5 w-px bg-slate-300 dark:bg-slate-600"></span>
    <button type="button" class={btn} title={tr({ en: 'Big heading', ar: 'عنوان كبير' }, $locale)} onclick={() => linePrefix('## ', tr({ en: 'Heading', ar: 'عنوان' }, $locale))}>{tr({ en: 'H', ar: 'عنوان' }, $locale)}<span class="text-base">+</span></button>
    <button type="button" class={btn} title={tr({ en: 'Small heading', ar: 'عنوان صغير' }, $locale)} onclick={() => linePrefix('### ', tr({ en: 'Subheading', ar: 'عنوان فرعي' }, $locale))}>h<span class="text-xs">+</span></button>
    <span class="mx-1 h-5 w-px bg-slate-300 dark:bg-slate-600"></span>
    <button type="button" class={btn} title={tr({ en: 'Bullet list', ar: 'قائمة نقطية' }, $locale)} onclick={() => linePrefix('- ', tr({ en: 'item', ar: 'عنصر' }, $locale))}>• {tr({ en: 'List', ar: 'قائمة' }, $locale)}</button>
    <button type="button" class={btn} title={tr({ en: 'Numbered list', ar: 'قائمة مرقمة' }, $locale)} onclick={() => linePrefix('1. ', tr({ en: 'item', ar: 'عنصر' }, $locale))}>1. {tr({ en: 'List', ar: 'قائمة' }, $locale)}</button>
    <button type="button" class={btn} title={tr({ en: 'Link', ar: 'رابط' }, $locale)} onclick={insertLink}>🔗</button>
    {#if onpolish}
      <button type="button" class="ms-auto rounded-md px-2.5 py-1 text-sm font-semibold text-white disabled:opacity-50" style="background: var(--brand)" disabled={polishing || !(value ?? '').trim()} onclick={polish}>
        {polishing ? tr({ en: '✨ Polishing…', ar: '✨ جارٍ التنسيق…' }, $locale) : tr({ en: '✨ Polish with AI', ar: '✨ نسّق بالذكاء الاصطناعي' }, $locale)}
      </button>
    {/if}
  </div>
{/if}

<textarea
  bind:this={el}
  class="input {format ? 'rounded-t-none' : ''}"
  dir={dir as 'ltr' | 'rtl' | 'auto'}
  {rows}
  {required}
  bind:value
></textarea>

{#if format}
  <p class="mt-1 text-xs text-slate-400">{tr({ en: 'Tip: select text then click B for bold, or use **bold**, *italic*, ## heading. Preview shows the final look.', ar: 'نصيحة: حدّد النص ثم اضغط B للعريض، أو استخدم **عريض**، *مائل*، ## عنوان. المعاينة تُظهر الشكل النهائي.' }, $locale)}</p>
{/if}
{#if polishError}<p class="mt-1 text-xs text-rose-600 dark:text-rose-400">{polishError}</p>{/if}
