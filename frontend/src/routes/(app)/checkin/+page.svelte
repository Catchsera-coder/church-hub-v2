<script lang="ts">
  import { onMount } from 'svelte';
  import * as QRCode from 'qrcode';
  import { api, ApiError } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import { can } from '$lib/stores/auth.js';
  import { dateTime } from '$lib/format.js';
  import PageHeader from '$lib/components/PageHeader.svelte';

  let events = $state<any[]>([]);
  let eventId = $state<number | null>(null);
  let token = $state('');
  let last = $state<{ ok: boolean; msg: string } | null>(null);
  let busy = $state(false);
  let qrDataUrl = $state('');
  let loadingEvents = $state(true);
  let expanded = $state(false); // fullscreen QR for projecting
  let scanInput = $state<HTMLInputElement | null>(null);

  // Inline "new gathering" so you can start a check-in without leaving the page.
  let showNew = $state(false);
  let newTitle = $state('');
  let creating = $state(false);
  let createErr = $state('');

  function nowLocal() {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  let newStartsAt = $state(nowLocal());

  const selected = $derived(events.find((e) => e.id === eventId) ?? null);
  const selfUrl = $derived(
    selected && typeof window !== 'undefined'
      ? `${window.location.origin}/checkin/self/${selected.publicToken}`
      : '',
  );
  const selName = $derived(selected ? tr(selected.title, $locale) || `#${selected.id}` : '');

  onMount(async () => {
    try {
      events = (await api<{ data: any[] }>('/attendance/events')).data;
      if (events.length) eventId = events[0].id;
      else showNew = true; // no gatherings yet — surface the create form immediately
    } finally {
      loadingEvents = false;
    }
  });

  // Regenerate the big-screen QR whenever the selected gathering changes.
  $effect(() => {
    const url = selfUrl;
    if (!url) { qrDataUrl = ''; return; }
    QRCode.toDataURL(url, { width: 360, margin: 1 }).then((d) => (qrDataUrl = d)).catch(() => (qrDataUrl = ''));
  });

  // Share the self check-in link to a servant's phone (or any device) so they can
  // walk the room. Uses the native share sheet where available, else copies.
  let copied = $state(false);
  async function shareLink() {
    if (!selfUrl) return;
    const title = selected ? tr(selected.title, $locale) : 'Check-in';
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title, text: tr({ en: 'Scan or tap to check in', ar: 'امسح أو اضغط لتسجيل الحضور' }, $locale), url: selfUrl });
        return;
      }
    } catch { /* user cancelled the share sheet — fall through to copy */ }
    try {
      await navigator.clipboard.writeText(selfUrl);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch { /* clipboard blocked — the link is shown below to copy manually */ }
  }

  async function createGathering(e: Event) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    creating = true; createErr = '';
    try {
      const { data } = await api<{ data: any }>('/attendance/events', {
        method: 'POST',
        body: JSON.stringify({ title: { en: newTitle.trim() }, serviceTypeId: null, startsAt: new Date(newStartsAt).toISOString() }),
      });
      events = [data, ...events];
      eventId = data.id;
      showNew = false;
      newTitle = '';
    } catch (err) { createErr = err instanceof ApiError ? err.message : (err as Error).message; } finally { creating = false; }
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (!eventId || !token.trim()) return;
    busy = true;
    try {
      const r = await api<{ data: { person: any; recorded: boolean } }>('/attendance/checkin', {
        method: 'POST',
        body: JSON.stringify({ eventId, qrToken: token.trim() }),
      });
      const name = `${tr(r.data.person.givenName, $locale)} ${tr(r.data.person.familyName, $locale)}`.trim();
      last = { ok: true, msg: r.data.recorded ? `${name} ✓` : tr({ en: `${name} — already checked in`, ar: `${name} — مسجّل مسبقاً` }, $locale) };
      token = '';
    } catch (err) {
      last = { ok: false, msg: err instanceof ApiError ? err.message : (err as Error).message };
    } finally {
      busy = false;
      // Keep focus on the box so the next scan lands immediately (kiosk mode).
      scanInput?.focus();
    }
  }
</script>

<PageHeader title={$t('nav.checkin')}>
  {#snippet actions()}
    {#if can('create attendance') && events.length}
      <button class="btn-ghost" onclick={() => (showNew = !showNew)}>+ {tr({ en: 'New gathering', ar: 'اجتماع جديد' }, $locale)}</button>
    {/if}
  {/snippet}
</PageHeader>

<!-- Gathering picker + inline create -->
<div class="mb-6 max-w-md space-y-3">
  {#if events.length}
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Gathering', ar: 'الاجتماع' }, $locale)}</span>
      <select class="input" bind:value={eventId}>
        {#each events as ev}<option value={ev.id}>{tr(ev.title, $locale) || `#${ev.id}`}</option>{/each}
      </select>
    </label>
  {:else if !loadingEvents && !showNew}
    <p class="text-sm text-slate-500 dark:text-slate-400">{tr({ en: 'No gatherings yet — create one to start checking people in.', ar: 'لا توجد اجتماعات بعد — أنشئ واحداً لبدء تسجيل الحضور.' }, $locale)}</p>
  {/if}

  {#if showNew}
    <form class="card space-y-3 p-4" onsubmit={createGathering}>
      <p class="text-sm font-medium">{tr({ en: 'New gathering', ar: 'اجتماع جديد' }, $locale)}</p>
      {#if createErr}<p class="text-xs text-rose-600 dark:text-rose-400">{createErr}</p>{/if}
      <input class="input" bind:value={newTitle} required placeholder={tr({ en: 'Title, e.g. Sunday service', ar: 'العنوان، مثال: خدمة الأحد' }, $locale)} />
      <input class="input force-ltr" type="datetime-local" bind:value={newStartsAt} required />
      <div class="flex gap-2">
        <button class="btn-primary shrink-0" type="submit" disabled={creating}>{creating ? $t('common.loading') : tr({ en: 'Create', ar: 'إنشاء' }, $locale)}</button>
        {#if events.length}<button type="button" class="btn-ghost shrink-0" onclick={() => (showNew = false)}>✕</button>{/if}
      </div>
    </form>
  {/if}
</div>

<div class="grid gap-6 lg:grid-cols-2">
  <!-- Big-screen self check-in QR -->
  <div class="card p-6 text-center">
    <h2 class="mb-1 text-lg font-semibold">{tr({ en: 'Self check-in', ar: 'تسجيل ذاتي' }, $locale)}</h2>
    <p class="mb-4 text-sm text-slate-500 dark:text-slate-400">
      {tr({ en: 'Show this on a screen. Members scan it, find their name, and tick who is here.', ar: 'اعرض هذا على شاشة. يمسحه الأعضاء، يجدون أسماءهم، ويحددون الحاضرين.' }, $locale)}
    </p>
    {#if !selected}
      <p class="py-16 text-slate-400">{tr({ en: 'Select or create a gathering to show the QR.', ar: 'اختر أو أنشئ اجتماعاً لعرض الرمز.' }, $locale)}</p>
    {:else if qrDataUrl}
      <!-- Clear gathering name above the QR so multiple services aren't confused. -->
      <p class="text-xl font-bold text-slate-900 dark:text-white">{selName}</p>
      <p class="mb-3 text-xs text-slate-500 force-ltr">{dateTime(selected.startsAt)}</p>
      <img src={qrDataUrl} alt="Check-in QR" class="mx-auto h-auto w-64 rounded-lg bg-white p-2" />
      <div class="mt-4 flex flex-wrap items-center justify-center gap-2">
        <button class="btn-primary" onclick={() => (expanded = true)}>⛶ {tr({ en: 'Expand', ar: 'تكبير' }, $locale)}</button>
        <button class="btn-ghost" onclick={shareLink}>
          {copied ? tr({ en: 'Copied ✓', ar: 'تم النسخ ✓' }, $locale) : tr({ en: 'Share link', ar: 'مشاركة الرابط' }, $locale)}
        </button>
        <a href={selfUrl} target="_blank" rel="noopener" class="btn-ghost">{tr({ en: 'Open', ar: 'فتح' }, $locale)}</a>
      </div>
      <a href={selfUrl} target="_blank" rel="noopener" class="mt-3 inline-block break-all text-xs text-primary-600 hover:underline dark:text-primary-300">{selfUrl}</a>
    {:else}
      <p class="py-16 text-slate-400">{tr({ en: 'Generating QR…', ar: 'جارٍ إنشاء الرمز…' }, $locale)}</p>
    {/if}
  </div>

  <!-- Manual: scan a member's personal QR / kiosk -->
  <div class="card p-6">
    <h2 class="mb-1 text-lg font-semibold">{tr({ en: 'Scan a member card', ar: 'مسح بطاقة العضو' }, $locale)}</h2>
    <p class="mb-3 text-sm text-slate-500 dark:text-slate-400">{tr({ en: 'Checking in to:', ar: 'التسجيل في:' }, $locale)} <b class="text-slate-700 dark:text-slate-200">{selName || '—'}</b></p>
    <form class="space-y-3" onsubmit={submit}>
      <!-- svelte-ignore a11y_autofocus -->
      <input class="input force-ltr" bind:this={scanInput} bind:value={token} autofocus placeholder={tr({ en: 'Scan a card, or type/paste a code…', ar: 'امسح بطاقة أو اكتب/الصق رمزاً…' }, $locale)} />
      <button class="btn-primary w-full" type="submit" disabled={busy || !eventId}>{tr({ en: 'Check in', ar: 'تسجيل الحضور' }, $locale)}</button>
    </form>
    {#if last}
      <div class="mt-4 rounded-lg p-4 text-center text-lg font-medium {last.ok ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'}">
        {last.msg}
      </div>
    {/if}

    <!-- How the kiosk scan works -->
    <div class="mt-5 rounded-lg bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
      <p class="mb-2 font-medium text-slate-700 dark:text-slate-200">{tr({ en: 'How this works', ar: 'كيف يعمل هذا' }, $locale)}</p>
      <ul class="list-disc space-y-1.5 ps-5">
        <li>{tr({ en: 'Use any QR/barcode scanner that works as a keyboard (USB or Bluetooth "HID" mode) — the common, plug-and-play kind (~$15–30). It types the scanned code into the box above and checks the person in automatically.', ar: 'استخدم أي ماسح QR/باركود يعمل كلوحة مفاتيح (USB أو بلوتوث بوضع "HID") — النوع الشائع الجاهز للتشغيل (~15–30$). يكتب الرمز الممسوح في الحقل أعلاه ويسجّل الشخص تلقائياً.' }, $locale)}</li>
        <li>{tr({ en: 'No scanner? A phone camera works too — keep this box focused and scan/paste the code.', ar: 'لا يوجد ماسح؟ كاميرا الهاتف تعمل أيضاً — أبقِ المؤشر في الحقل وامسح/الصق الرمز.' }, $locale)}</li>
        <li>{tr({ en: "It reads each member's personal QR — found on their member page (Members → open a person → Check-in card), which you can print as a wallet card.", ar: 'يقرأ رمز العضو الشخصي — الموجود في صفحة العضو (الأعضاء ← افتح شخصاً ← بطاقة الحضور)، ويمكنك طباعته كبطاقة.' }, $locale)}</li>
        <li>{tr({ en: 'Scanning is instant and repeatable — a second scan of the same person is safely ignored.', ar: 'المسح فوري وقابل للتكرار — يُتجاهل مسح نفس الشخص مرة ثانية بأمان.' }, $locale)}</li>
      </ul>
    </div>
  </div>
</div>

<!-- Fullscreen QR for projecting (click anywhere to collapse) -->
{#if expanded && qrDataUrl}
  <button class="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-white p-6 dark:bg-slate-950" onclick={() => (expanded = false)} aria-label={tr({ en: 'Close', ar: 'إغلاق' }, $locale)}>
    <p class="text-3xl font-bold text-slate-900 dark:text-white sm:text-5xl">{selName}</p>
    <img src={qrDataUrl} alt="Check-in QR" class="h-auto w-[70vmin] max-w-[80vw] rounded-xl bg-white p-3" style="image-rendering: pixelated" />
    <p class="text-lg text-slate-500">{tr({ en: 'Scan with your phone to check in', ar: 'امسح بهاتفك لتسجيل الحضور' }, $locale)}</p>
    <p class="text-sm text-slate-400">{tr({ en: 'Tap anywhere to close', ar: 'اضغط في أي مكان للإغلاق' }, $locale)}</p>
  </button>
{/if}
