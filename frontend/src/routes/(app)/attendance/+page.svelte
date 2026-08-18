<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import { dateTime } from '$lib/format.js';
  import { can, hasRole } from '$lib/stores/auth.js';
  import DataTable from '$lib/components/DataTable.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

  let rows = $state<any[]>([]);
  let loading = $state(true);
  let search = $state('');
  const isSuper = hasRole('Super Admin');

  const shown = $derived(
    search.trim()
      ? rows.filter((e) => (tr(e.title, $locale) || '').toLowerCase().includes(search.trim().toLowerCase()))
      : rows,
  );

  async function load() {
    loading = true;
    try { rows = (await api<{ data: any[] }>('/attendance/events')).data; } finally { loading = false; }
  }
  onMount(load);

  // Single delete
  let confirmOne = $state<any | null>(null);
  let deleting = $state(false);
  async function doDeleteOne() {
    if (!confirmOne) return;
    deleting = true;
    try { await api(`/attendance/events/${confirmOne.id}`, { method: 'DELETE' }); confirmOne = null; await load(); }
    catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); }
    finally { deleting = false; }
  }

  // Bulk delete everything currently shown (for cleaning up duplicate/test gatherings)
  let confirmBulk = $state(false);
  let bulkBusy = $state(false);
  async function doDeleteShown() {
    bulkBusy = true;
    try {
      for (const e of [...shown]) await api(`/attendance/events/${e.id}`, { method: 'DELETE' });
      confirmBulk = false; await load();
    } catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); }
    finally { bulkBusy = false; }
  }
</script>

<PageHeader title={$t('nav.attendance')}>
  {#snippet actions()}
    {#if can('create attendance')}<a href="/attendance/new" class="btn-primary">{$t('common.new')}</a>{/if}
  {/snippet}
</PageHeader>

<div class="mb-4 flex flex-wrap items-center gap-3">
  <input class="input max-w-xs" placeholder={tr({ en: 'Search gatherings…', ar: 'بحث عن الاجتماعات…' }, $locale)} bind:value={search} />
  {#if isSuper && search.trim() && shown.length > 0}
    <button class="btn-ghost text-sm text-rose-600 dark:text-rose-400" onclick={() => (confirmBulk = true)}>
      {tr({ en: `Delete these ${shown.length}`, ar: `حذف هذه (${shown.length})` }, $locale)}
    </button>
  {/if}
</div>

<DataTable loading={loading} rows={shown} headers={[tr({ en: 'Gathering', ar: 'الاجتماع' }, $locale), tr({ en: 'Starts', ar: 'يبدأ' }, $locale), isSuper ? '' : '']}>
  {#snippet row(e)}
    <td class="p-3 font-medium">
      <a class="text-primary-700 hover:underline dark:text-primary-300" href="/attendance/{e.id}">{tr(e.title, $locale) || '—'}</a>
    </td>
    <td class="p-3 force-ltr text-slate-600 dark:text-slate-300">{dateTime(e.startsAt)}</td>
    <td class="p-3 text-end">
      {#if isSuper}
        <button class="text-xs text-rose-600 hover:underline dark:text-rose-400" onclick={() => (confirmOne = e)}>{$t('common.delete')}</button>
      {/if}
    </td>
  {/snippet}
</DataTable>

<ConfirmDialog
  open={confirmOne !== null}
  danger
  title={tr({ en: 'Delete this gathering?', ar: 'حذف هذا الاجتماع؟' }, $locale)}
  message={tr({ en: 'This permanently deletes the gathering and its attendance records.', ar: 'يحذف هذا الاجتماع وسجلات حضوره نهائياً.' }, $locale)}
  confirmLabel={$t('common.delete')}
  busy={deleting}
  onconfirm={doDeleteOne}
  oncancel={() => (confirmOne = null)}
/>

<ConfirmDialog
  bind:open={confirmBulk}
  danger
  title={tr({ en: `Delete ${shown.length} gatherings?`, ar: `حذف ${shown.length} اجتماعاً؟` }, $locale)}
  message={tr({ en: 'This permanently deletes ALL gatherings currently shown (matching your search) and their attendance records. Type DELETE to confirm.', ar: 'يحذف نهائياً كل الاجتماعات المعروضة حالياً (المطابقة لبحثك) وسجلات حضورها. اكتب DELETE للتأكيد.' }, $locale)}
  requireText="DELETE"
  confirmLabel={$t('common.delete')}
  busy={bulkBusy}
  onconfirm={doDeleteShown}
/>
