<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import { can } from '$lib/stores/auth.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import GatheringQr from '$lib/components/GatheringQr.svelte';

  let events = $state<any[]>([]);
  let eventId = $state<number | null>(null);
  let token = $state('');
  let last = $state<{ ok: boolean; msg: string } | null>(null);
  let busy = $state(false);
  let loadingEvents = $state(true);
  let viewAll = $state(false); // show a grid of every gathering's QR at once
  let scanInput = $state<HTMLInputElement | null>(null);
  // Which check-in method is shown. Members self-serve via QR; staff use by-name
  // or a scanner. Picking one reveals only its controls (less clutter at a kiosk).
  let method = $state<'self' | 'name' | 'card'>('self');
  const METHODS = [
    { v: 'self', icon: '📱', label: { en: 'Self check-in QR', ar: 'رمز التسجيل الذاتي' } },
    { v: 'name', icon: '🔤', label: { en: 'By name', ar: 'بالاسم' } },
    { v: 'card', icon: '🎫', label: { en: 'Scan a card', ar: 'مسح بطاقة' } },
  ] as const;

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

  // --- Manual check-in by name (works for whichever gathering is selected) ---
  let nameQuery = $state('');
  let nameResults = $state<any[]>([]);
  let nameTimer: ReturnType<typeof setTimeout>;
  let recent = $state<{ name: string; dup: boolean }[]>([]);

  function searchByName() {
    clearTimeout(nameTimer);
    nameTimer = setTimeout(async () => {
      if (!nameQuery.trim()) { nameResults = []; return; }
      const q = new URLSearchParams({ search: nameQuery.trim(), limit: '8' });
      nameResults = (await api<{ data: any[] }>(`/people?${q}`)).data;
    }, 250);
  }

  async function checkInPerson(p: any) {
    if (!eventId) return;
    const name = `${tr(p.givenName, $locale)} ${tr(p.familyName, $locale)}`.trim();
    try {
      const r = await api<{ data: { duplicate?: boolean } }>(`/attendance/events/${eventId}/records`, {
        method: 'POST', body: JSON.stringify({ personId: p.id }),
      });
      recent = [{ name, dup: !!r.data?.duplicate }, ...recent].slice(0, 8);
      nameQuery = ''; nameResults = [];
    } catch (err) {
      last = { ok: false, msg: err instanceof ApiError ? err.message : (err as Error).message };
    }
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
      <button class="btn-ghost" onclick={() => (showNew = !showNew)}>+ {tr({ en: 'New attendance', ar: 'حضور جديد' }, $locale)}</button>
    {/if}
  {/snippet}
</PageHeader>

<!-- Gathering picker + inline create -->
<div class="mb-5 max-w-md space-y-3">
  {#if events.length}
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Attendance', ar: 'الحضور' }, $locale)}</span>
      <select class="input" bind:value={eventId}>
        {#each events as ev}<option value={ev.id}>{tr(ev.title, $locale) || `#${ev.id}`}</option>{/each}
      </select>
    </label>
  {:else if !loadingEvents && !showNew}
    <p class="text-sm text-slate-500 dark:text-slate-400">{tr({ en: 'No attendance records yet — create one to start checking people in.', ar: 'لا توجد سجلات حضور بعد — أنشئ واحداً لبدء تسجيل الحضور.' }, $locale)}</p>
  {/if}

  {#if showNew}
    <form class="card space-y-3 p-4" onsubmit={createGathering}>
      <p class="text-sm font-medium">{tr({ en: 'New attendance', ar: 'حضور جديد' }, $locale)}</p>
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

{#if events.length}
  <!-- Method selector: pick how to check people in; only that panel shows. -->
  <div class="mb-6">
    <p class="mb-2 text-sm font-medium text-slate-600 dark:text-slate-300">{tr({ en: 'Check-in method', ar: 'طريقة التسجيل' }, $locale)}</p>
    <div class="inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
      {#each METHODS as m}
        <button
          class="rounded-lg px-4 py-2 text-sm font-medium transition {method === m.v ? 'bg-white shadow-sm dark:bg-slate-900' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'}"
          style={method === m.v ? 'color: var(--brand)' : ''}
          onclick={() => (method = m.v)}
        >{m.icon} {tr(m.label, $locale)}</button>
      {/each}
    </div>
  </div>

  <!-- SELF CHECK-IN QR -->
  {#if method === 'self'}
    <div class="max-w-3xl">
      <p class="mb-3 text-sm text-slate-500 dark:text-slate-400">
        {tr({ en: 'Show this on a screen or share it. Members scan it, find their name, and tick who is here.', ar: 'اعرضه على شاشة أو شاركه. يمسحه الأعضاء، يجدون أسماءهم، ويحددون الحاضرين.' }, $locale)}
      </p>
      {#if events.length > 1}
        <label class="mb-3 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input type="checkbox" bind:checked={viewAll} />
          {tr({ en: 'Show all service QRs at once (for simultaneous services)', ar: 'إظهار جميع رموز الخدمات معاً (للخدمات المتزامنة)' }, $locale)}
        </label>
      {/if}
      {#if viewAll}
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {#each events as ev (ev.id)}<GatheringQr event={ev} />{/each}
        </div>
      {:else if selected}
        <div class="max-w-sm"><GatheringQr event={selected} /></div>
      {:else}
        <p class="card p-6 py-16 text-center text-slate-400">{tr({ en: 'Select an attendance record to show the QR.', ar: 'اختر سجل حضور لعرض الرمز.' }, $locale)}</p>
      {/if}
    </div>
  {/if}

  <!-- BY NAME -->
  {#if method === 'name'}
    <div class="card max-w-lg p-6">
      <p class="mb-4 text-sm text-slate-500 dark:text-slate-400">{tr({ en: 'To:', ar: 'إلى:' }, $locale)} <b class="text-slate-700 dark:text-slate-200">{selName || '—'}</b></p>
      <div class="relative">
        <input class="input" bind:value={nameQuery} oninput={searchByName} disabled={!eventId}
          placeholder={tr({ en: 'Type a name to check in…', ar: 'اكتب اسماً لتسجيل الحضور…' }, $locale)} />
        {#if nameResults.length}
          <div class="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow dark:border-slate-700 dark:bg-slate-900">
            {#each nameResults as p}
              <button type="button" class="flex w-full items-center justify-between px-3 py-2 text-start text-sm hover:bg-slate-100 dark:hover:bg-slate-800" onclick={() => checkInPerson(p)}>
                <span>{tr(p.givenName, $locale)} {tr(p.familyName, $locale)}</span>
                <span class="text-xs capitalize text-slate-400">{p.membershipStatus}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
      {#if recent.length}
        <div class="mt-3 space-y-1">
          {#each recent as r}
            <div class="flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-1.5 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              <span>✓</span><span class="flex-1">{r.name}</span>
              {#if r.dup}<span class="text-xs text-emerald-600/70">{tr({ en: 'already in', ar: 'مسجّل مسبقاً' }, $locale)}</span>{/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <!-- BY CARD (scanner) -->
  {#if method === 'card'}
    <div class="card max-w-lg p-6">
      <p class="mb-4 text-sm text-slate-500 dark:text-slate-400">{tr({ en: 'To:', ar: 'إلى:' }, $locale)} <b class="text-slate-700 dark:text-slate-200">{selName || '—'}</b></p>
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
  {/if}
{/if}
