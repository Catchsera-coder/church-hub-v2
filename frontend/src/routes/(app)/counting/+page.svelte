<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import { money, date } from '$lib/format.js';
  import { can } from '$lib/stores/auth.js';
  import DataTable from '$lib/components/DataTable.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import PageHint from '$lib/components/PageHint.svelte';

  let rows = $state<any[]>([]);
  let loading = $state(true);

  async function load() {
    loading = true;
    try { rows = (await api<{ data: any[] }>('/batches')).data; } finally { loading = false; }
  }
  onMount(load);

  async function close(b: any) {
    let reason: string | null = null;
    if (!b.reconciles) {
      reason = prompt(tr({ en: 'Out of balance — reason to close anyway?', ar: 'غير متوازنة — سبب الإغلاق؟' }, $locale));
      if (!reason) return;
    } else if (!confirm(tr({ en: 'Close this session?', ar: 'إغلاق هذه الجلسة؟' }, $locale))) {
      return;
    }
    try {
      await api(`/batches/${b.id}/close`, { method: 'POST', body: JSON.stringify({ reason: reason ?? undefined }) });
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : (err as Error).message);
    }
  }
</script>

<PageHeader title={$t('nav.counting')}>
  {#snippet actions()}
    {#if can('create batch')}<a href="/counting/new" class="btn-primary">{$t('common.new')}</a>{/if}
  {/snippet}
</PageHeader>
<PageHint id="counting" text={{ en: 'A counting session groups the contributions counted together (e.g. one Sunday offering) so two people can reconcile the total before it is posted. Open one to add entries and close it when it balances.', ar: 'جلسة العدّ تجمع التبرعات المعدودة معاً (مثل عطاء أحد واحد) ليطابق شخصان الإجمالي قبل ترحيله. افتح واحدة لإضافة الإدخالات وأغلقها عند توازنها.' }} />

<DataTable {loading} {rows}
  headers={[tr({ en: 'Session', ar: 'الجلسة' }, $locale), tr({ en: 'Date', ar: 'التاريخ' }, $locale), tr({ en: 'Counted', ar: 'المعدود' }, $locale), tr({ en: 'Entered', ar: 'المُدخل' }, $locale), tr({ en: 'Variance', ar: 'الفرق' }, $locale), tr({ en: 'Status', ar: 'الحالة' }, $locale), '']}>
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
    <td class="p-3 text-end">
      {#if !b.closedAt && can('update batch')}
        <button class="text-xs text-primary-600 hover:underline dark:text-primary-300" onclick={() => close(b)}>{tr({ en: 'Close', ar: 'إغلاق' }, $locale)}</button>
      {/if}
    </td>
  {/snippet}
</DataTable>
