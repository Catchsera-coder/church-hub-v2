<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import { dateTime } from '$lib/format.js';
  import DataTable from '$lib/components/DataTable.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';

  const id = Number($page.params.id);
  let records = $state<any[]>([]);
  let loading = $state(true);

  async function load() {
    loading = true;
    try { records = (await api<{ data: any[] }>(`/attendance/events/${id}/records`)).data; }
    finally { loading = false; }
  }
  onMount(load);
</script>

<PageHeader title={tr({ en: 'Attendance', ar: 'الحضور' }, $locale)} />
<p class="mb-4 text-sm text-slate-500">{records.length} {tr({ en: 'checked in', ar: 'مسجّل' }, $locale)}</p>

<DataTable {loading} rows={records} headers={[tr({ en: 'Name', ar: 'الاسم' }, $locale), tr({ en: 'Checked in', ar: 'وقت التسجيل' }, $locale)]}>
  {#snippet row(r)}
    <td class="p-3 font-medium">{tr(r.givenName, $locale)} {tr(r.familyName, $locale)}</td>
    <td class="p-3 force-ltr text-slate-600 dark:text-slate-300">{dateTime(r.checkedInAt)}</td>
  {/snippet}
</DataTable>
