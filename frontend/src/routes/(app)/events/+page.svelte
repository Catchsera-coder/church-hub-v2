<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import { money, date } from '$lib/format.js';
  import { can } from '$lib/stores/auth.js';
  import DataTable from '$lib/components/DataTable.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import PageHint from '$lib/components/PageHint.svelte';

  let rows = $state<any[]>([]);
  let loading = $state(true);
  onMount(async () => { try { rows = (await api<{ data: any[] }>('/events')).data; } finally { loading = false; } });
</script>

<PageHeader title={$t('nav.events')}>
  {#snippet actions()}
    {#if can('create event')}<a href="/events/new" class="btn-primary">{$t('common.new')}</a>{/if}
  {/snippet}
</PageHeader>
<PageHint id="events" text={{ en: 'The church calendar. Add upcoming events with date, time and details to keep everyone informed — and message attendees from the Messages tab.', ar: 'تقويم الكنيسة. أضِف الأحداث القادمة بالتاريخ والوقت والتفاصيل لإبقاء الجميع على اطلاع.' }} />

<DataTable {loading} {rows} headers={[tr({ en: 'Event', ar: 'الفعالية' }, $locale), tr({ en: 'Starts', ar: 'يبدأ' }, $locale), tr({ en: 'Venue', ar: 'المكان' }, $locale), tr({ en: 'Fee', ar: 'الرسوم' }, $locale), tr({ en: 'Registered', ar: 'المسجّلون' }, $locale)]}>
  {#snippet row(e)}
    <td class="p-3 font-medium">
      <a class="text-primary-700 hover:underline dark:text-primary-300" href="/events/{e.id}">{tr(e.name, $locale) || '—'}</a>
    </td>
    <td class="p-3 force-ltr text-slate-600 dark:text-slate-300">{date(e.startsOn)}</td>
    <td class="p-3 text-slate-600 dark:text-slate-300">{e.venue ?? '—'}</td>
    <td class="p-3 text-end force-ltr">{e.feeAmountMinor ? money(e.feeAmountMinor) : '—'}</td>
    <td class="p-3 text-end">{e.registrants ?? 0}</td>
  {/snippet}
</DataTable>
