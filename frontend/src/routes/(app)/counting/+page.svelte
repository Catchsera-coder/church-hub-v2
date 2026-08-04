<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import { money, date } from '$lib/format.js';
  import DataTable from '$lib/components/DataTable.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';

  let rows = $state<any[]>([]);
  let loading = $state(true);
  onMount(async () => { try { rows = (await api<{ data: any[] }>('/batches')).data; } finally { loading = false; } });
</script>

<PageHeader title={$t('nav.counting')} />
<DataTable {loading} {rows}
  headers={[tr({ en: 'Session', ar: 'الجلسة' }, $locale), tr({ en: 'Date', ar: 'التاريخ' }, $locale), tr({ en: 'Counted', ar: 'المعدود' }, $locale), tr({ en: 'Entered', ar: 'المُدخل' }, $locale), tr({ en: 'Variance', ar: 'الفرق' }, $locale), tr({ en: 'Status', ar: 'الحالة' }, $locale)]}>
  {#snippet row(b)}
    <td class="p-3 font-medium">{b.name}</td>
    <td class="p-3 force-ltr text-slate-600 dark:text-slate-300">{date(b.receivedOn)}</td>
    <td class="p-3 text-end force-ltr">{money(b.expectedTotalCents)}</td>
    <td class="p-3 text-end force-ltr">{money(b.enteredCents)}</td>
    <td class="p-3 text-end force-ltr font-medium {b.varianceCents ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}">
      {b.varianceCents === null ? '—' : money(b.varianceCents)}
    </td>
    <td class="p-3">
      {#if b.closedAt}
        <span class="rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">{tr({ en: 'Closed', ar: 'مغلقة' }, $locale)}</span>
      {:else}
        <span class="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">{tr({ en: 'Open', ar: 'مفتوحة' }, $locale)}</span>
      {/if}
    </td>
  {/snippet}
</DataTable>
