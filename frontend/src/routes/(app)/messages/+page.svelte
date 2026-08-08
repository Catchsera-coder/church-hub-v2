<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import { dateTime } from '$lib/format.js';
  import { can } from '$lib/stores/auth.js';
  import DataTable from '$lib/components/DataTable.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';

  let rows = $state<any[]>([]);
  let loading = $state(true);
  let sending = $state<number | null>(null);

  async function load() {
    loading = true;
    try { rows = (await api<{ data: any[] }>('/messages')).data; } finally { loading = false; }
  }
  onMount(load);

  const statusColor = (s: string) => s === 'sent' ? 'text-emerald-600' : s === 'failed' ? 'text-rose-600' : s === 'scheduled' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500';

  async function sendNow(m: any) {
    if (!confirm(tr({ en: `Send "${m.name}" now to all matching members?`, ar: `إرسال «${m.name}» الآن لكل الأعضاء المطابقين؟` }, $locale))) return;
    sending = m.id;
    try {
      const { data } = await api<{ data: { sent: number; total: number } }>(`/messages/${m.id}/send`, { method: 'POST' });
      alert(tr({ en: `Sent to ${data.sent} of ${data.total}.`, ar: `أُرسلت إلى ${data.sent} من ${data.total}.` }, $locale));
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : (err as Error).message);
    } finally { sending = null; }
  }
</script>

<PageHeader title={$t('nav.messages')}>
  {#snippet actions()}
    {#if can('view message')}<a href="/messages/templates" class="btn-ghost">{tr({ en: 'Templates', ar: 'القوالب' }, $locale)}</a>{/if}
    {#if can('create message')}<a href="/messages/new" class="btn-primary">{$t('common.new')}</a>{/if}
  {/snippet}
</PageHeader>

<DataTable {loading} {rows} headers={[tr({ en: 'Name', ar: 'الاسم' }, $locale), tr({ en: 'Channel', ar: 'القناة' }, $locale), tr({ en: 'Status', ar: 'الحالة' }, $locale), tr({ en: 'Recipients', ar: 'المستلمون' }, $locale), tr({ en: 'Sent', ar: 'أُرسلت' }, $locale), '']}>
  {#snippet row(m)}
    <td class="p-3 font-medium">{m.name}</td>
    <td class="p-3 uppercase text-xs text-slate-500">{m.channel}</td>
    <td class="p-3 capitalize font-medium {statusColor(m.status)}">
      {m.status}
      {#if m.status === 'scheduled' && m.scheduledFor}<span class="block text-xs font-normal text-slate-400 force-ltr">{dateTime(m.scheduledFor)}</span>{/if}
    </td>
    <td class="p-3 text-end">{m.recipients ?? 0}</td>
    <td class="p-3 force-ltr text-slate-600 dark:text-slate-300">{m.sentAt ? dateTime(m.sentAt) : '—'}</td>
    <td class="p-3 text-end">
      {#if (m.status === 'draft' || m.status === 'scheduled') && can('update message')}
        <button class="text-xs text-primary-600 hover:underline dark:text-primary-300 disabled:opacity-50" disabled={sending === m.id} onclick={() => sendNow(m)}>
          {sending === m.id ? $t('common.loading') : tr({ en: 'Send now', ar: 'إرسال الآن' }, $locale)}
        </button>
      {/if}
    </td>
  {/snippet}
</DataTable>
