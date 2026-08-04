<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import DataTable from '$lib/components/DataTable.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';

  let rows = $state<any[]>([]);
  let loading = $state(true);
  onMount(async () => { try { rows = (await api<{ data: any[] }>('/funds')).data; } finally { loading = false; } });
</script>

<PageHeader title={$t('nav.funds')} />
<DataTable {loading} {rows} headers={['Code', tr({ en: 'Name', ar: 'الاسم' }, $locale), tr({ en: 'Tax-deductible', ar: 'معفى ضريبياً' }, $locale), tr({ en: 'Active', ar: 'مُفعّل' }, $locale)]}>
  {#snippet row(f)}
    <td class="p-3 font-mono text-xs text-slate-500 force-ltr">{f.code}</td>
    <td class="p-3 font-medium">{tr(f.name, $locale)}</td>
    <td class="p-3">{f.isTaxDeductible ? '✓' : '—'}</td>
    <td class="p-3">{f.isActive ? '✓' : '—'}</td>
  {/snippet}
</DataTable>
