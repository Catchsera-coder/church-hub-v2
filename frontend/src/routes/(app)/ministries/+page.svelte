<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import { can } from '$lib/stores/auth.js';
  import PageHeader from '$lib/components/PageHeader.svelte';

  let rows = $state<any[]>([]);
  let loading = $state(true);
  let busy = $state<number | null>(null);

  const canEdit = can('update ministry');
  const canCreate = can('create ministry');
  const canDelete = can('delete ministry');

  async function load() {
    loading = true;
    try { rows = (await api<{ data: any[] }>('/ministries')).data; } finally { loading = false; }
  }
  onMount(load);

  // Build the tree. Any ministry whose parent isn't in the active set (e.g. the
  // parent was deleted) is shown at the top level.
  const activeIds = $derived(new Set(rows.map((r) => r.id)));
  const topLevel = $derived(
    rows
      .filter((m) => m.parentId == null || !activeIds.has(m.parentId))
      .sort((a, b) => (a.sortOrder - b.sortOrder) || tr(a.name, $locale).localeCompare(tr(b.name, $locale))),
  );
  const childrenOf = (pid: number) =>
    rows.filter((m) => m.parentId === pid)
      .sort((a, b) => (a.sortOrder - b.sortOrder) || tr(a.name, $locale).localeCompare(tr(b.name, $locale)));

  async function duplicate(m: any) {
    busy = m.id;
    try {
      await api('/ministries', {
        method: 'POST',
        body: JSON.stringify({
          name: { ...m.name, en: `${m.name?.en ?? ''} (copy)`.trim(), ...(m.name?.ar ? { ar: `${m.name.ar} (نسخة)` } : {}) },
          description: m.description ?? {},
          ageGroup: m.ageGroup ?? null,
          defaultSchedule: m.defaultSchedule ?? null,
          parentId: m.parentId ?? null,
          sortOrder: m.sortOrder ?? 0,
          isActive: m.isActive ?? true,
        }),
      });
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : (err as Error).message);
    } finally { busy = null; }
  }

  async function remove(m: any) {
    const kids = childrenOf(m.id).length;
    const warn = kids > 0
      ? tr({ en: `Delete "${tr(m.name, $locale)}"? Its ${kids} sub-ministr${kids === 1 ? 'y' : 'ies'} will move to the top level.`, ar: `حذف «${tr(m.name, $locale)}»؟ ستنتقل خدماتها الفرعية (${kids}) إلى المستوى الأعلى.` }, $locale)
      : tr({ en: `Delete "${tr(m.name, $locale)}"?`, ar: `حذف «${tr(m.name, $locale)}»؟` }, $locale);
    if (!confirm(warn)) return;
    busy = m.id;
    try {
      await api(`/ministries/${m.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : (err as Error).message);
    } finally { busy = null; }
  }
</script>

<PageHeader title={$t('nav.ministries')}>
  {#snippet actions()}
    {#if canCreate}<a href="/ministries/new" class="btn-primary">{$t('common.new')}</a>{/if}
  {/snippet}
</PageHeader>

<div class="card overflow-x-auto">
  {#if loading}
    <p class="p-6 text-slate-400">{$t('common.loading')}</p>
  {:else if rows.length === 0}
    <p class="p-8 text-center text-slate-500">{tr({ en: 'No ministries yet — add your first, or group them into sub-ministries.', ar: 'لا توجد خدمات بعد — أضِف أول واحدة أو جمّعها في خدمات فرعية.' }, $locale)}</p>
  {:else}
    <table class="w-full text-sm">
      <thead class="border-b border-slate-200 text-slate-500 dark:border-slate-800">
        <tr>
          <th class="p-3 text-start font-medium">{tr({ en: 'Ministry', ar: 'الخدمة' }, $locale)}</th>
          <th class="p-3 text-start font-medium">{tr({ en: 'Age group', ar: 'الفئة' }, $locale)}</th>
          <th class="p-3 text-start font-medium">{tr({ en: 'Schedule', ar: 'الجدول' }, $locale)}</th>
          <th class="p-3 text-end font-medium"></th>
        </tr>
      </thead>
      <tbody>
        {#each topLevel as m}{@render branch(m, 0)}{/each}
      </tbody>
    </table>
  {/if}
</div>

{#snippet branch(m: any, depth: number)}
  {@const kids = childrenOf(m.id)}
  <tr class="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
    <td class="p-3 font-medium">
      <span style="padding-inline-start: {depth * 22}px" class="inline-flex items-center gap-2">
        {#if depth > 0}<span class="text-slate-300 dark:text-slate-600">↳</span>{/if}
        {#if canEdit}
          <a class="text-primary-700 hover:underline dark:text-primary-300" href="/ministries/{m.id}">{tr(m.name, $locale) || '—'}</a>
        {:else}{tr(m.name, $locale) || '—'}{/if}
        {#if kids.length}<span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">{tr({ en: 'group', ar: 'مجموعة' }, $locale)} · {kids.length}</span>{/if}
      </span>
    </td>
    <td class="p-3 capitalize text-slate-600 dark:text-slate-300">{m.ageGroup ?? '—'}</td>
    <td class="p-3 text-slate-600 dark:text-slate-300">{m.defaultSchedule ?? '—'}</td>
    <td class="p-3 text-end whitespace-nowrap">
      {#if canEdit}<a href="/ministries/{m.id}" class="text-xs text-primary-600 hover:underline dark:text-primary-300">{tr({ en: 'Edit', ar: 'تعديل' }, $locale)}</a>{/if}
      {#if canCreate}<button class="ms-3 text-xs text-slate-500 hover:underline disabled:opacity-50 dark:text-slate-400" disabled={busy === m.id} onclick={() => duplicate(m)}>{tr({ en: 'Duplicate', ar: 'تكرار' }, $locale)}</button>{/if}
      {#if canDelete}<button class="ms-3 text-xs text-rose-600 hover:underline disabled:opacity-50 dark:text-rose-400" disabled={busy === m.id} onclick={() => remove(m)}>{$t('common.delete')}</button>{/if}
    </td>
  </tr>
  {#each kids as c}{@render branch(c, depth + 1)}{/each}
{/snippet}
