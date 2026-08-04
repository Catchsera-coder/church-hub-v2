<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import { dateTime } from '$lib/format.js';
  import DataTable from '$lib/components/DataTable.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';

  let rows = $state<any[]>([]);
  let loading = $state(true);
  onMount(async () => { try { rows = (await api<{ data: any[] }>('/messages')).data; } finally { loading = false; } });

  const statusColor = (s: string) => s === 'sent' ? 'text-emerald-600' : s === 'failed' ? 'text-rose-600' : 'text-slate-500';
</script>

<PageHeader title={$t('nav.messages')} />
<DataTable {loading} {rows} headers={[tr({ en: 'Name', ar: 'الاسم' }, $locale), tr({ en: 'Channel', ar: 'القناة' }, $locale), tr({ en: 'Status', ar: 'الحالة' }, $locale), tr({ en: 'Recipients', ar: 'المستلمون' }, $locale), tr({ en: 'Sent', ar: 'أُرسلت' }, $locale)]}>
  {#snippet row(m)}
    <td class="p-3 font-medium">{m.name}</td>
    <td class="p-3 uppercase text-xs text-slate-500">{m.channel}</td>
    <td class="p-3 capitalize font-medium {statusColor(m.status)}">{m.status}</td>
    <td class="p-3 text-end">{m.recipients ?? 0}</td>
    <td class="p-3 force-ltr text-slate-600 dark:text-slate-300">{m.sentAt ? dateTime(m.sentAt) : '—'}</td>
  {/snippet}
</DataTable>
