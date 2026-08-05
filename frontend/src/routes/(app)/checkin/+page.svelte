<script lang="ts">
  import { onMount } from 'svelte';
  import * as QRCode from 'qrcode';
  import { api, ApiError } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import PageHeader from '$lib/components/PageHeader.svelte';

  let events = $state<any[]>([]);
  let eventId = $state<number | null>(null);
  let token = $state('');
  let last = $state<{ ok: boolean; msg: string } | null>(null);
  let busy = $state(false);
  let qrDataUrl = $state('');

  const selected = $derived(events.find((e) => e.id === eventId) ?? null);
  const selfUrl = $derived(
    selected && typeof window !== 'undefined'
      ? `${window.location.origin}/checkin/self/${selected.publicToken}`
      : '',
  );

  onMount(async () => {
    events = (await api<{ data: any[] }>('/attendance/events')).data;
    if (events.length) eventId = events[0].id;
  });

  // Regenerate the big-screen QR whenever the selected gathering changes.
  $effect(() => {
    const url = selfUrl;
    if (!url) { qrDataUrl = ''; return; }
    QRCode.toDataURL(url, { width: 360, margin: 1 }).then((d) => (qrDataUrl = d)).catch(() => (qrDataUrl = ''));
  });

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
      last = { ok: true, msg: `${name} ✓` };
      token = '';
    } catch (err) {
      last = { ok: false, msg: err instanceof ApiError ? err.message : (err as Error).message };
    } finally {
      busy = false;
    }
  }
</script>

<PageHeader title={$t('nav.checkin')} />

<div class="mb-4 max-w-md">
  <label class="block space-y-1">
    <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Gathering', ar: 'الاجتماع' }, $locale)}</span>
    <select class="input" bind:value={eventId}>
      {#each events as ev}<option value={ev.id}>{tr(ev.title, $locale) || `#${ev.id}`}</option>{/each}
    </select>
  </label>
  {#if !events.length}
    <p class="mt-2 text-sm text-slate-400">{tr({ en: 'Create a gathering first (Attendance → New).', ar: 'أنشئ اجتماعاً أولاً (الحضور ← جديد).' }, $locale)}</p>
  {/if}
</div>

<div class="grid gap-6 lg:grid-cols-2">
  <!-- Big-screen self check-in QR -->
  <div class="card p-6 text-center">
    <h2 class="mb-1 text-lg font-semibold">{tr({ en: 'Self check-in', ar: 'تسجيل ذاتي' }, $locale)}</h2>
    <p class="mb-4 text-sm text-slate-500 dark:text-slate-400">
      {tr({ en: 'Show this on a screen. Members scan it, find their name, and tick who is here.', ar: 'اعرض هذا على شاشة. يمسحه الأعضاء، يجدون أسماءهم، ويحددون الحاضرين.' }, $locale)}
    </p>
    {#if qrDataUrl}
      <img src={qrDataUrl} alt="Check-in QR" class="mx-auto h-auto w-64 rounded-lg bg-white p-2" />
      <a href={selfUrl} target="_blank" rel="noopener" class="mt-3 inline-block break-all text-xs text-primary-600 hover:underline dark:text-primary-300">{selfUrl}</a>
    {:else}
      <p class="py-16 text-slate-400">{$t('common.loading')}</p>
    {/if}
  </div>

  <!-- Manual: scan a member's personal QR / kiosk -->
  <div class="card p-6">
    <h2 class="mb-1 text-lg font-semibold">{tr({ en: 'Manual / member card', ar: 'يدوي / بطاقة العضو' }, $locale)}</h2>
    <p class="mb-4 text-sm text-slate-500 dark:text-slate-400">{tr({ en: "Scan a member's personal QR code, or type it.", ar: 'امسح رمز العضو الشخصي أو اكتبه.' }, $locale)}</p>
    <form class="space-y-4" onsubmit={submit}>
      <!-- svelte-ignore a11y_autofocus -->
      <input class="input force-ltr" bind:value={token} autofocus placeholder="00000000-0000-0000-0000-000000000000" />
      <button class="btn-primary w-full" type="submit" disabled={busy || !eventId}>{tr({ en: 'Check in', ar: 'تسجيل الحضور' }, $locale)}</button>
    </form>
    {#if last}
      <div class="mt-4 rounded-lg p-4 text-center text-lg font-medium {last.ok ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'}">
        {last.msg}
      </div>
    {/if}
  </div>
</div>
