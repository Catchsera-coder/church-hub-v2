<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import PageHeader from '$lib/components/PageHeader.svelte';

  let events = $state<any[]>([]);
  let eventId = $state<number | null>(null);
  let token = $state('');
  let last = $state<{ ok: boolean; msg: string } | null>(null);
  let busy = $state(false);

  onMount(async () => {
    events = (await api<{ data: any[] }>('/attendance/events')).data;
    if (events.length) eventId = events[0].id;
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

<div class="mx-auto max-w-md">
  <form class="card space-y-4 p-6" onsubmit={submit}>
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Gathering', ar: 'الاجتماع' }, $locale)}</span>
      <select class="input" bind:value={eventId}>
        {#each events as ev}<option value={ev.id}>{tr(ev.title, $locale) || `#${ev.id}`}</option>{/each}
      </select>
    </label>
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Scan or enter code', ar: 'امسح أو أدخل الرمز' }, $locale)}</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input class="input force-ltr" bind:value={token} autofocus placeholder="00000000-0000-0000-0000-000000000000" />
    </label>
    <button class="btn-primary w-full" type="submit" disabled={busy || !eventId}>{tr({ en: 'Check in', ar: 'تسجيل الحضور' }, $locale)}</button>
  </form>

  {#if last}
    <div class="mt-4 rounded-lg p-4 text-center text-lg font-medium {last.ok ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'}">
      {last.msg}
    </div>
  {/if}
</div>
