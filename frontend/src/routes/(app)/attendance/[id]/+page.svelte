<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api, ApiError } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import { dateTime } from '$lib/format.js';
  import { can } from '$lib/stores/auth.js';
  import DataTable from '$lib/components/DataTable.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';

  const id = Number($page.params.id);
  let records = $state<any[]>([]);
  let loading = $state(true);
  const manage = can('create attendance');

  // Person typeahead for manual check-in
  let personQuery = $state('');
  let personResults = $state<any[]>([]);
  let adding = $state(false);
  let searchTimer: ReturnType<typeof setTimeout>;

  async function load() {
    loading = true;
    try { records = (await api<{ data: any[] }>(`/attendance/events/${id}/records`)).data; }
    finally { loading = false; }
  }
  onMount(load);

  function searchPeople() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      if (!personQuery.trim()) { personResults = []; return; }
      const q = new URLSearchParams({ search: personQuery.trim(), limit: '8' });
      personResults = (await api<{ data: any[] }>(`/people?${q}`)).data;
    }, 250);
  }

  async function checkIn(p: any) {
    adding = true;
    try {
      await api(`/attendance/events/${id}/records`, { method: 'POST', body: JSON.stringify({ personId: p.id }) });
      personQuery = ''; personResults = [];
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : (err as Error).message);
    } finally { adding = false; }
  }
</script>

<PageHeader title={tr({ en: 'Attendance', ar: 'الحضور' }, $locale)} />

{#if manage}
  <div class="relative mb-4 max-w-sm">
    <input class="input" bind:value={personQuery} oninput={searchPeople} disabled={adding}
      placeholder={tr({ en: 'Check someone in…', ar: 'تسجيل حضور شخص…' }, $locale)} />
    {#if personResults.length}
      <div class="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow dark:border-slate-700 dark:bg-slate-900">
        {#each personResults as p}
          <button type="button" class="block w-full px-3 py-2 text-start text-sm hover:bg-slate-100 dark:hover:bg-slate-800" onclick={() => checkIn(p)}>
            {tr(p.givenName, $locale)} {tr(p.familyName, $locale)}
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<p class="mb-4 text-sm text-slate-500">{records.length} {tr({ en: 'checked in', ar: 'مسجّل' }, $locale)}</p>

<DataTable {loading} rows={records} headers={[tr({ en: 'Name', ar: 'الاسم' }, $locale), tr({ en: 'Checked in', ar: 'وقت التسجيل' }, $locale)]}>
  {#snippet row(r)}
    <td class="p-3 font-medium">{tr(r.givenName, $locale)} {tr(r.familyName, $locale)}</td>
    <td class="p-3 force-ltr text-slate-600 dark:text-slate-300">{dateTime(r.checkedInAt)}</td>
  {/snippet}
</DataTable>
