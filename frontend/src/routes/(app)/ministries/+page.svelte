<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import DataTable from '$lib/components/DataTable.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';

  let rows = $state<any[]>([]);
  let loading = $state(true);
  onMount(async () => { try { rows = (await api<{ data: any[] }>('/ministries')).data; } finally { loading = false; } });
</script>

<PageHeader title={$t('nav.ministries')} />
<DataTable {loading} {rows} headers={[tr({ en: 'Ministry', ar: 'الخدمة' }, $locale), tr({ en: 'Age group', ar: 'الفئة' }, $locale), tr({ en: 'Schedule', ar: 'الجدول' }, $locale)]}>
  {#snippet row(m)}
    <td class="p-3 font-medium">{tr(m.name, $locale)}</td>
    <td class="p-3 capitalize text-slate-600 dark:text-slate-300">{m.ageGroup ?? '—'}</td>
    <td class="p-3 text-slate-600 dark:text-slate-300">{m.defaultSchedule ?? '—'}</td>
  {/snippet}
</DataTable>
