<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import { money, date } from '$lib/format.js';
  import DataTable from '$lib/components/DataTable.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';

  let rows = $state<any[]>([]);
  let loading = $state(true);
  onMount(async () => { try { rows = (await api<{ data: any[] }>('/events')).data; } finally { loading = false; } });
</script>

<PageHeader title={$t('nav.events')} />
<DataTable {loading} {rows} headers={[tr({ en: 'Event', ar: 'الفعالية' }, $locale), tr({ en: 'Starts', ar: 'يبدأ' }, $locale), tr({ en: 'Venue', ar: 'المكان' }, $locale), tr({ en: 'Fee', ar: 'الرسوم' }, $locale), tr({ en: 'Registered', ar: 'المسجّلون' }, $locale)]}>
  {#snippet row(e)}
    <td class="p-3 font-medium">{tr(e.name, $locale) || '—'}</td>
    <td class="p-3 force-ltr text-slate-600 dark:text-slate-300">{date(e.startsOn)}</td>
    <td class="p-3 text-slate-600 dark:text-slate-300">{e.venue ?? '—'}</td>
    <td class="p-3 text-end force-ltr">{e.feeAmountMinor ? money(e.feeAmountMinor) : '—'}</td>
    <td class="p-3 text-end">{e.registrants ?? 0}</td>
  {/snippet}
</DataTable>
