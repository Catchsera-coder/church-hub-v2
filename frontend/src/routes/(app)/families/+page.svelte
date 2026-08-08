<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import { can } from '$lib/stores/auth.js';
  import DataTable from '$lib/components/DataTable.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import FilterBar from '$lib/components/FilterBar.svelte';
  import ExportMenu from '$lib/components/ExportMenu.svelte';

  let rows = $state<any[]>([]);
  let loading = $state(true);
  let search = $state('');
  let timer: ReturnType<typeof setTimeout>;

  const EMPTY = { city: '', hasChildren: '', minSize: '', missingContact: '' };
  let f = $state({ ...EMPTY });
  const activeCount = $derived(Object.values(f).filter((v) => v !== '').length);

  async function load() {
    loading = true;
    try {
      const q = new URLSearchParams({ limit: '50' });
      if (search.trim()) q.set('search', search.trim());
      for (const [k, v] of Object.entries(f)) if (v !== '') q.set(k, String(v));
      rows = (await api<{ data: any[] }>(`/families?${q}`)).data;
    } finally {
      loading = false;
    }
  }
  function onSearch() { clearTimeout(timer); timer = setTimeout(load, 300); }
  function clearFilters() { f = { ...EMPTY }; load(); }
  onMount(load);
  const editable = can('update household');
</script>

<PageHeader title={$t('nav.families')}>
  {#snippet actions()}
    <ExportMenu resource="families" title={tr({ en: 'Families', ar: 'العائلات' }, $locale)} />
    {#if can('create household')}<a href="/families/new" class="btn-primary">{$t('common.new')}</a>{/if}
  {/snippet}
</PageHeader>
<div class="mb-3"><input class="input max-w-xs" placeholder={$t('common.search')} bind:value={search} oninput={onSearch} /></div>

<FilterBar active={activeCount} onclear={clearFilters}>
  <label class="text-sm">
    <span class="mb-1 block text-slate-500">{tr({ en: 'City', ar: 'المدينة' }, $locale)}</span>
    <input class="input w-40" bind:value={f.city} oninput={onSearch} />
  </label>
  <label class="text-sm">
    <span class="mb-1 block text-slate-500">{tr({ en: 'Family size', ar: 'حجم العائلة' }, $locale)}</span>
    <select class="input w-36" bind:value={f.minSize} onchange={load}>
      <option value="">{tr({ en: 'Any', ar: 'الكل' }, $locale)}</option>
      <option value="2">2+</option>
      <option value="3">3+</option>
      <option value="5">5+</option>
    </select>
  </label>
  <label class="flex items-center gap-2 pb-2 text-sm text-slate-600 dark:text-slate-300">
    <input type="checkbox" checked={f.hasChildren === 'true'} onchange={(e) => { f.hasChildren = (e.currentTarget as HTMLInputElement).checked ? 'true' : ''; load(); }} />
    {tr({ en: 'Has children', ar: 'لديها أطفال' }, $locale)}
  </label>
  <label class="flex items-center gap-2 pb-2 text-sm text-slate-600 dark:text-slate-300">
    <input type="checkbox" checked={f.missingContact === 'true'} onchange={(e) => { f.missingContact = (e.currentTarget as HTMLInputElement).checked ? 'true' : ''; load(); }} />
    {tr({ en: 'Missing contact', ar: 'بدون بيانات تواصل' }, $locale)}
  </label>
</FilterBar>

<DataTable {loading} {rows} headers={[tr({ en: 'Family', ar: 'العائلة' }, $locale), tr({ en: 'Members', ar: 'الأفراد' }, $locale), tr({ en: 'Phone', ar: 'الهاتف' }, $locale), tr({ en: 'City', ar: 'المدينة' }, $locale)]}>
  {#snippet row(f)}
    <td class="p-3 font-medium">
      {#if editable}<a class="text-primary-700 hover:underline dark:text-primary-300" href="/families/{f.id}">{tr(f.name, $locale)}</a>{:else}{tr(f.name, $locale)}{/if}
    </td>
    <td class="p-3 text-slate-600 dark:text-slate-300">
      {f.memberCount ?? 0}
      {#if f.childCount > 0}<span class="ms-1 text-xs text-slate-400">({f.childCount} {tr({ en: 'children', ar: 'أطفال' }, $locale)})</span>{/if}
    </td>
    <td class="p-3 force-ltr text-slate-600 dark:text-slate-300">{f.homePhone ?? '—'}</td>
    <td class="p-3 text-slate-600 dark:text-slate-300">{f.city ?? '—'}</td>
  {/snippet}
</DataTable>
