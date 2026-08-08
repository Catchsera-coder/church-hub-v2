<script lang="ts">
  import * as QRCode from 'qrcode';
  import { locale, tr } from '$lib/i18n.js';
  import { dateTime } from '$lib/format.js';

  // A self-check-in QR for one gathering: clearly named, expandable to a
  // projector-friendly fullscreen, and shareable. Each gathering has its own
  // token, so any number of these run at the same time without interfering.
  let { event }: { event: any } = $props();

  let qr = $state('');
  let expanded = $state(false);
  let copied = $state(false);

  const url = $derived(typeof window !== 'undefined' ? `${window.location.origin}/checkin/self/${event.publicToken}` : '');
  const name = $derived(tr(event.title, $locale) || `#${event.id}`);

  $effect(() => {
    const u = url;
    if (!u) { qr = ''; return; }
    QRCode.toDataURL(u, { width: 360, margin: 1 }).then((d) => (qr = d)).catch(() => (qr = ''));
  });

  async function share() {
    try { if (navigator.share) { await navigator.share({ title: name, url }); return; } } catch { /* cancelled */ }
    try { await navigator.clipboard.writeText(url); copied = true; setTimeout(() => (copied = false), 2000); } catch { /* blocked */ }
  }
</script>

<div class="card p-5 text-center">
  <p class="text-lg font-bold text-slate-900 dark:text-white">{name}</p>
  <p class="mb-2 text-xs text-slate-500 force-ltr">{dateTime(event.startsAt)}</p>
  {#if qr}
    <img src={qr} alt="Check-in QR" class="mx-auto w-48 rounded-lg bg-white p-2 print:w-56" />
    <div class="mt-3 flex flex-wrap items-center justify-center gap-2 print:hidden">
      <button class="btn-primary" onclick={() => (expanded = true)}>⛶ {tr({ en: 'Expand', ar: 'تكبير' }, $locale)}</button>
      <button class="btn-ghost" onclick={share}>{copied ? tr({ en: 'Copied ✓', ar: 'تم النسخ ✓' }, $locale) : tr({ en: 'Share', ar: 'مشاركة' }, $locale)}</button>
      <a class="btn-ghost" href={url} target="_blank" rel="noopener">{tr({ en: 'Open', ar: 'فتح' }, $locale)}</a>
    </div>
  {:else}
    <p class="py-10 text-slate-400">…</p>
  {/if}
</div>

{#if expanded && qr}
  <button class="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-white p-6 dark:bg-slate-950" onclick={() => (expanded = false)} aria-label={tr({ en: 'Close', ar: 'إغلاق' }, $locale)}>
    <p class="text-3xl font-bold text-slate-900 dark:text-white sm:text-5xl">{name}</p>
    <img src={qr} alt="Check-in QR" class="h-auto w-[70vmin] max-w-[80vw] rounded-xl bg-white p-3" style="image-rendering: pixelated" />
    <p class="text-lg text-slate-500">{tr({ en: 'Scan with your phone to check in', ar: 'امسح بهاتفك لتسجيل الحضور' }, $locale)}</p>
    <p class="text-sm text-slate-400">{tr({ en: 'Tap anywhere to close', ar: 'اضغط في أي مكان للإغلاق' }, $locale)}</p>
  </button>
{/if}
