<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api, ApiError } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import { date } from '$lib/format.js';
  import { can } from '$lib/stores/auth.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import EventForm from '$lib/components/EventForm.svelte';

  const id = Number($page.params.id);
  let event = $state<any>(null);
  let registrants = $state<any[]>([]);
  const manage = can('update event');

  // Person typeahead for registration
  let personQuery = $state('');
  let personResults = $state<any[]>([]);
  let adding = $state(false);
  let searchTimer: ReturnType<typeof setTimeout>;

  // Role for the next registration.
  let role = $state('attendee');
  let roleNote = $state('');
  const ROLES = [
    { v: 'attendee', label: { en: 'Attendee (pays fee)', ar: 'مشارك (يدفع الرسوم)' } },
    { v: 'guest', label: { en: 'Guest (free)', ar: 'ضيف (مجاناً)' } },
    { v: 'speaker', label: { en: 'Speaker', ar: 'متحدث' } },
    { v: 'singer', label: { en: 'Singer', ar: 'مرنّم' } },
    { v: 'musician', label: { en: 'Musician', ar: 'موسيقي' } },
    { v: 'free', label: { en: 'Free addition', ar: 'إضافة مجانية' } },
    { v: 'other', label: { en: 'Other…', ar: 'أخرى…' } },
  ];
  const roleLabel = (v: string) => tr(ROLES.find((r) => r.v === v)?.label ?? { en: v, ar: v }, $locale);

  async function loadEvent() {
    const all = (await api<{ data: any[] }>('/events')).data;
    event = all.find((e) => e.id === id) ?? null;
  }
  async function loadRegistrants() {
    registrants = (await api<{ data: any[] }>(`/events/${id}/registrants`)).data;
  }
  onMount(async () => { await Promise.all([loadEvent(), loadRegistrants()]); });

  function searchPeople() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      if (!personQuery.trim()) { personResults = []; return; }
      const q = new URLSearchParams({ search: personQuery.trim(), limit: '8' });
      personResults = (await api<{ data: any[] }>(`/people?${q}`)).data;
    }, 250);
  }

  async function register(p: any) {
    adding = true;
    try {
      await api(`/events/${id}/registrants`, { method: 'POST', body: JSON.stringify({ personId: p.id, role, roleNote: role === 'other' ? roleNote : null }) });
      personQuery = ''; personResults = [];
      await loadRegistrants();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : (err as Error).message);
    } finally { adding = false; }
  }

  async function unregister(r: any) {
    if (!confirm(tr({ en: 'Remove this registration?', ar: 'إزالة هذا التسجيل؟' }, $locale))) return;
    await api(`/events/${id}/registrants/${r.id}`, { method: 'DELETE' });
    await loadRegistrants();
  }
</script>

<PageHeader title={event ? tr(event.name, $locale) : tr({ en: 'Event', ar: 'الفعالية' }, $locale)} />

{#if !event}
  <p class="text-slate-400">{$t('common.loading')}</p>
{:else}
  <div class="grid gap-8 lg:grid-cols-2">
    <section class="space-y-3">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">{tr({ en: 'Details', ar: 'التفاصيل' }, $locale)}</h2>
      {#if manage}
        <EventForm initial={event} {id} />
      {:else}
        <div class="card space-y-2 p-6 text-sm">
          <p>{tr({ en: 'Starts', ar: 'يبدأ' }, $locale)}: <span class="force-ltr">{date(event.startsOn)}</span></p>
          {#if event.venue}<p>{tr({ en: 'Venue', ar: 'المكان' }, $locale)}: {event.venue}</p>{/if}
        </div>
      {/if}
    </section>

    <section class="space-y-3">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">
        {tr({ en: 'Registrations', ar: 'التسجيلات' }, $locale)} ({registrants.length}{event.capacity ? `/${event.capacity}` : ''})
      </h2>

      {#if manage}
        <div class="flex gap-2">
          <select class="input" bind:value={role}>
            {#each ROLES as r}<option value={r.v}>{tr(r.label, $locale)}</option>{/each}
          </select>
          {#if role === 'other'}
            <input class="input" bind:value={roleNote} placeholder={tr({ en: 'Specify role', ar: 'حدّد الدور' }, $locale)} />
          {/if}
        </div>
        <div class="relative">
          <input class="input" bind:value={personQuery} oninput={searchPeople} disabled={adding || !event.registrationOpen}
            placeholder={event.registrationOpen ? tr({ en: 'Add person as ' + roleLabel(role) + '…', ar: 'إضافة شخص كـ ' + roleLabel(role) + '…' }, $locale) : tr({ en: 'Registration closed', ar: 'التسجيل مغلق' }, $locale)} />
          {#if personResults.length}
            <div class="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow dark:border-slate-700 dark:bg-slate-900">
              {#each personResults as p}
                <button type="button" class="block w-full px-3 py-2 text-start text-sm hover:bg-slate-100 dark:hover:bg-slate-800" onclick={() => register(p)}>
                  {tr(p.givenName, $locale)} {tr(p.familyName, $locale)}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <div class="card divide-y divide-slate-100 dark:divide-slate-800">
        {#if !registrants.length}
          <p class="p-4 text-sm text-slate-400">{tr({ en: 'No registrations yet.', ar: 'لا تسجيلات بعد.' }, $locale)}</p>
        {/if}
        {#each registrants as r}
          <div class="flex items-center justify-between p-3 text-sm">
            <span class="flex items-center gap-2">
              {tr(r.givenName, $locale)} {tr(r.familyName, $locale)}
              {#if r.role && r.role !== 'attendee'}
                <span class="rounded bg-primary-50 px-2 py-0.5 text-xs text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">{r.role === 'other' && r.roleNote ? r.roleNote : roleLabel(r.role)}</span>
              {/if}
            </span>
            {#if manage}
              <button class="text-xs text-rose-600 hover:underline" onclick={() => unregister(r)}>{$t('common.delete')}</button>
            {/if}
          </div>
        {/each}
      </div>
    </section>
  </div>
{/if}
