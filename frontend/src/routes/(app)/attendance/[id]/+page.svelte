<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api.js';
  import { t, locale, tr, enabledLocales } from '$lib/i18n.js';
  import { dateTime } from '$lib/format.js';
  import { can, hasRole } from '$lib/stores/auth.js';
  import DataTable from '$lib/components/DataTable.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

  const id = Number($page.params.id);
  let event = $state<any>(null);
  let records = $state<any[]>([]);
  let loading = $state(true);
  const manage = can('create attendance');
  const canEdit = can('update attendance');
  const isSuper = hasRole('Super Admin');

  // 'all' | 'new' (visitor/self-registered) | 'member' (regular/member).
  let who = $state<'all' | 'new' | 'member'>('all');
  const filtered = $derived(records.filter((r) => {
    if (who === 'new') return r.selfRegistered || r.membershipStatus === 'visitor';
    if (who === 'member') return r.membershipStatus === 'regular' || r.membershipStatus === 'member';
    return true;
  }));

  // Rename
  let editing = $state(false);
  let title = $state<Record<string, string>>({});
  let savingTitle = $state(false);

  // Delete
  let confirmDelete = $state(false);
  let deleting = $state(false);

  // Person typeahead for manual check-in
  let personQuery = $state('');
  let personResults = $state<any[]>([]);
  let adding = $state(false);
  let searchTimer: ReturnType<typeof setTimeout>;

  async function load() {
    loading = true;
    try {
      const [ev, recs] = await Promise.all([
        api<{ data: any }>(`/attendance/events/${id}`),
        api<{ data: any[] }>(`/attendance/events/${id}/records`),
      ]);
      event = ev.data;
      title = { ...(ev.data.title ?? {}) };
      records = recs.data;
    } finally { loading = false; }
  }
  onMount(load);

  async function saveTitle() {
    savingTitle = true;
    try {
      await api(`/attendance/events/${id}`, { method: 'PUT', body: JSON.stringify({ title }) });
      event.title = { ...title };
      editing = false;
    } catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); }
    finally { savingTitle = false; }
  }

  async function doDelete() {
    deleting = true;
    try {
      await api(`/attendance/events/${id}`, { method: 'DELETE' });
      await goto('/attendance');
    } catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); deleting = false; }
  }

  function searchPeople() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      if (!personQuery.trim()) { personResults = []; return; }
      const q = new URLSearchParams({ search: personQuery.trim(), limit: '8' });
      personResults = (await api<{ data: any[] }>(`/people?${q}`)).data;
    }, 250);
  }

  async function checkIn(p: any) {
    adding = true;
    try {
      await api(`/attendance/events/${id}/records`, { method: 'POST', body: JSON.stringify({ personId: p.id }) });
      personQuery = ''; personResults = [];
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : (err as Error).message);
    } finally { adding = false; }
  }
</script>

<PageHeader title={event ? tr(event.title, $locale) || tr({ en: 'Gathering', ar: 'اجتماع' }, $locale) : tr({ en: 'Gathering', ar: 'اجتماع' }, $locale)} back="/attendance">
  {#snippet actions()}
    {#if canEdit}<button class="btn-ghost" onclick={() => (editing = !editing)}>{tr({ en: 'Rename', ar: 'إعادة تسمية' }, $locale)}</button>{/if}
    {#if isSuper}<button class="btn-ghost text-rose-600 dark:text-rose-400" onclick={() => (confirmDelete = true)}>{$t('common.delete')}</button>{/if}
  {/snippet}
</PageHeader>

{#if event}
  <p class="mb-4 -mt-2 text-sm text-slate-500 force-ltr">{dateTime(event.startsAt)}</p>
{/if}

{#if editing}
  <div class="card mb-4 max-w-md space-y-3 p-4">
    {#each $enabledLocales as l}
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Name', ar: 'الاسم' }, $locale)} ({l.native})</span>
        <input class="input" dir={l.dir} bind:value={title[l.code]} />
      </label>
    {/each}
    <div class="flex gap-2">
      <button class="btn-primary" onclick={saveTitle} disabled={savingTitle}>{savingTitle ? $t('common.loading') : $t('common.save')}</button>
      <button class="btn-ghost" onclick={() => { editing = false; title = { ...(event.title ?? {}) }; }}>{tr({ en: 'Cancel', ar: 'إلغاء' }, $locale)}</button>
    </div>
  </div>
{/if}

{#if manage}
  <div class="relative mb-4 max-w-sm">
    <input class="input" bind:value={personQuery} oninput={searchPeople} disabled={adding}
      placeholder={tr({ en: 'Check someone in…', ar: 'تسجيل حضور شخص…' }, $locale)} />
    {#if personResults.length}
      <div class="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow dark:border-slate-700 dark:bg-slate-900">
        {#each personResults as p}
          <button type="button" class="block w-full px-3 py-2 text-start text-sm hover:bg-slate-100 dark:hover:bg-slate-800" onclick={() => checkIn(p)}>
            {tr(p.givenName, $locale)} {tr(p.familyName, $locale)}
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<!-- New-vs-member filter -->
<div class="mb-3 flex items-center gap-2">
  {#each [['all', { en: 'All', ar: 'الكل' }], ['new', { en: 'New', ar: 'جدد' }], ['member', { en: 'Members', ar: 'أعضاء' }]] as [val, lbl]}
    <button class="btn-ghost text-sm {who === val ? 'ring-1 ring-slate-300 dark:ring-slate-600' : ''}" style={who === val ? 'color: var(--brand)' : ''} onclick={() => (who = val as any)}>{tr(lbl as any, $locale)}</button>
  {/each}
  <span class="ms-auto text-sm text-slate-500">{filtered.length} {tr({ en: 'checked in', ar: 'مسجّل' }, $locale)}</span>
</div>

<DataTable {loading} rows={filtered} headers={[tr({ en: 'Name', ar: 'الاسم' }, $locale), tr({ en: 'Status', ar: 'الحالة' }, $locale), tr({ en: 'Checked in', ar: 'وقت التسجيل' }, $locale)]}>
  {#snippet row(r)}
    <td class="p-3 font-medium">
      {tr(r.givenName, $locale)} {tr(r.familyName, $locale)}
      {#if r.selfRegistered && !r.reviewedAt}<span class="ms-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{tr({ en: 'new', ar: 'جديد' }, $locale)}</span>{/if}
    </td>
    <td class="p-3 capitalize text-slate-600 dark:text-slate-300">{r.membershipStatus}</td>
    <td class="p-3 force-ltr text-slate-600 dark:text-slate-300">{dateTime(r.checkedInAt)}</td>
  {/snippet}
</DataTable>

<ConfirmDialog
  bind:open={confirmDelete}
  danger
  title={tr({ en: 'Delete this gathering?', ar: 'حذف هذا الاجتماع؟' }, $locale)}
  message={tr({ en: 'This permanently deletes the gathering AND all of its attendance records. This cannot be undone. Type the gathering name to confirm.', ar: 'سيؤدي هذا إلى حذف الاجتماع وكل سجلات الحضور نهائياً. لا يمكن التراجع. اكتب اسم الاجتماع للتأكيد.' }, $locale)}
  requireText={event ? tr(event.title, $locale) : ''}
  confirmLabel={$t('common.delete')}
  busy={deleting}
  onconfirm={doDelete}
/>
