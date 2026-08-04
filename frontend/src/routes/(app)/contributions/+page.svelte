<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import { money, date } from '$lib/format.js';
  import { can } from '$lib/stores/auth.js';
  import DataTable from '$lib/components/DataTable.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';

  let rows = $state<any[]>([]);
  let net = $state(0);
  let loading = $state(true);

  async function load() {
    loading = true;
    try {
      const r = await api<{ data: any[]; meta: { netTotalCents: number } }>('/contributions?limit=50');
      rows = r.data;
      net = r.meta.netTotalCents;
    } finally { loading = false; }
  }
  onMount(load);

  const donor = (c: any) => c.isAnonymous ? tr({ en: 'Anonymous', ar: 'مجهول' }, $locale) : `${tr(c.givenName ?? {}, $locale)} ${tr(c.familyName ?? {}, $locale)}`.trim() || '—';

  async function reverse(c: any) {
    const reason = prompt(tr({ en: 'Reason for reversing this gift?', ar: 'سبب عكس هذه العطية؟' }, $locale));
    if (!reason) return;
    await api(`/contributions/${c.id}/reverse`, { method: 'POST', body: JSON.stringify({ reason }) });
    await load();
  }
</script>

<PageHeader title={$t('nav.contributions')}>
  {#snippet actions()}
    {#if can('create contribution')}<a href="/contributions/new" class="btn-primary">{tr({ en: 'Record a gift', ar: 'تسجيل عطية' }, $locale)}</a>{/if}
  {/snippet}
</PageHeader>

<div class="mb-4 card inline-block px-4 py-3">
  <span class="text-sm text-slate-500">{tr({ en: 'Net total (shown)', ar: 'الإجمالي الصافي' }, $locale)}: </span>
  <span class="font-semibold force-ltr">{money(net)}</span>
</div>

<DataTable {loading} {rows} headers={[tr({ en: 'Date', ar: 'التاريخ' }, $locale), tr({ en: 'Donor', ar: 'المتبرّع' }, $locale), tr({ en: 'Fund', ar: 'الصندوق' }, $locale), tr({ en: 'Method', ar: 'الطريقة' }, $locale), tr({ en: 'Amount', ar: 'المبلغ' }, $locale), '']}>
  {#snippet row(c)}
    <td class="p-3 force-ltr text-slate-600 dark:text-slate-300">{date(c.receivedOn)}</td>
    <td class="p-3">{donor(c)}</td>
    <td class="p-3 text-slate-600 dark:text-slate-300">{c.fundName ? tr(c.fundName, $locale) : c.fundCode ?? '—'}</td>
    <td class="p-3 capitalize text-slate-600 dark:text-slate-300">{c.method}</td>
    <td class="p-3 text-end force-ltr font-medium {c.amountCents < 0 ? 'text-rose-600 dark:text-rose-400' : ''}">{money(c.amountCents, c.currency)}</td>
    <td class="p-3 text-end">
      {#if can('create contribution') && c.amountCents > 0 && !c.reversesId}
        <button class="text-xs text-rose-600 hover:underline dark:text-rose-400" onclick={() => reverse(c)}>{tr({ en: 'Reverse', ar: 'عكس' }, $locale)}</button>
      {/if}
    </td>
  {/snippet}
</DataTable>
