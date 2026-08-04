<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import { dateTime } from '$lib/format.js';
  import DataTable from '$lib/components/DataTable.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';

  let rows = $state<any[]>([]);
  let loading = $state(true);
  onMount(async () => { try { rows = (await api<{ data: any[] }>('/activity?limit=100')).data; } finally { loading = false; } });
</script>

<PageHeader title={$t('nav.activity')} />
<DataTable {loading} {rows} headers={[tr({ en: 'When', ar: 'متى' }, $locale), tr({ en: 'Who', ar: 'من' }, $locale), tr({ en: 'Action', ar: 'الإجراء' }, $locale), tr({ en: 'Subject', ar: 'العنصر' }, $locale)]}>
  {#snippet row(a)}
    <td class="p-3 force-ltr text-slate-600 dark:text-slate-300">{dateTime(a.createdAt)}</td>
    <td class="p-3 text-slate-600 dark:text-slate-300">{a.causer ?? '—'}</td>
    <td class="p-3 capitalize">{a.event}</td>
    <td class="p-3 text-slate-600 dark:text-slate-300">{a.subjectType}{a.subjectId ? ` #${a.subjectId}` : ''}{a.description ? ` — ${a.description}` : ''}</td>
  {/snippet}
</DataTable>
