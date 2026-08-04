<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import { date } from '$lib/format.js';
  import DataTable from '$lib/components/DataTable.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';

  let rows = $state<any[]>([]);
  let loading = $state(true);
  onMount(async () => { try { rows = (await api<{ data: any[] }>('/sermons?limit=50')).data; } finally { loading = false; } });
</script>

<PageHeader title={$t('nav.sermons')} />
<DataTable {loading} {rows} headers={[tr({ en: 'Title', ar: 'العنوان' }, $locale), tr({ en: 'Speaker', ar: 'المتحدث' }, $locale), tr({ en: 'Date', ar: 'التاريخ' }, $locale), tr({ en: 'Published', ar: 'منشور' }, $locale)]}>
  {#snippet row(s)}
    <td class="p-3 font-medium">{tr(s.title, $locale) || '—'}</td>
    <td class="p-3 text-slate-600 dark:text-slate-300">{s.speaker ?? '—'}</td>
    <td class="p-3 force-ltr text-slate-600 dark:text-slate-300">{date(s.preachedOn)}</td>
    <td class="p-3">{s.isPublished ? '✓' : '—'}</td>
  {/snippet}
</DataTable>
