<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { t, locale, tr, displayName } from '$lib/i18n.js';
  import { nameOrder } from '$lib/stores/prefs.js';
  import { can } from '$lib/stores/auth.js';
  import DataTable from '$lib/components/DataTable.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import FilterBar from '$lib/components/FilterBar.svelte';
  import ExportMenu from '$lib/components/ExportMenu.svelte';
  import PageHint from '$lib/components/PageHint.svelte';

  let rows = $state<any[]>([]);
  let loading = $state(true);
  let search = $state('');
  let showEmpty = $state(false);
  let timer: ReturnType<typeof setTimeout>;

  // Click the member count to peek at who's in the household — fetched on demand
  // and cached, so the list stays snappy without leaving the page.
  let expanded = $state<Set<number>>(new Set());
  let memberCache = $state<Record<number, any[]>>({});
  let loadingMembers = $state<Set<number>>(new Set());
  async function toggleMembers(fam: any) {
    const next = new Set(expanded);
    if (next.has(fam.id)) { next.delete(fam.id); expanded = next; return; }
    next.add(fam.id); expanded = next;
    if (memberCache[fam.id] || !fam.memberCount) return;
    const busy = new Set(loadingMembers); busy.add(fam.id); loadingMembers = busy;
    try { memberCache = { ...memberCache, [fam.id]: (await api<{ data: any[] }>(`/families/${fam.id}/members`)).data }; }
    catch { memberCache = { ...memberCache, [fam.id]: [] }; }
    finally { const b = new Set(loadingMembers); b.delete(fam.id); loadingMembers = b; }
  }
  function isHead(r?: string | null) { const x = (r ?? '').trim().toLowerCase(); return x === 'self' || x === 'head' || x === 'رب الأسرة'; }

  // Empty (0-member) families are leftovers — e.g. after the last person moved to
  // another household. Let the admin clear them in one click (soft delete).
  let deleting = $state<number | null>(null);
  async function deleteEmpty(fam: any) {
    if (deleting) return;
    if (!confirm(tr({ en: `Delete the empty family “${tr(fam.name, $locale)}”? It has no members. You can recreate it anytime.`, ar: `حذف العائلة الفارغة "${tr(fam.name, $locale)}"؟ لا تحتوي على أفراد.` }, $locale))) return;
    deleting = fam.id;
    try { await api(`/families/${fam.id}`, { method: 'DELETE' }); rows = rows.filter((r) => r.id !== fam.id); }
    catch (err) { alert((err as Error).message); }
    finally { deleting = null; }
  }

  const EMPTY = { city: '', hasChildren: '', minSize: '', missingContact: '' };
  let f = $state({ ...EMPTY });
  const activeCount = $derived(Object.values(f).filter((v) => v !== '').length);

  const exportParams = $derived.by(() => {
    const p = new URLSearchParams();
    if (search.trim()) p.set('search', search.trim());
    for (const [k, v] of Object.entries(f)) if (v !== '') p.set(k, String(v));
    return p.toString();
  });

  async function load() {
    loading = true;
    try {
      const q = new URLSearchParams({ limit: '50' });
      if (search.trim()) q.set('search', search.trim());
      if (showEmpty) q.set('empty', 'include');
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
    <ExportMenu resource="families" title={tr({ en: 'Families', ar: 'العائلات' }, $locale)} params={exportParams} />
    {#if can('create household')}<a href="/families/new" class="btn-primary">{$t('common.new')}</a>{/if}
  {/snippet}
</PageHeader>
<PageHint id="families-list" text={{ en: 'A family groups people in one household. The Members count and Phone are pulled from the people linked to it. Click a family to see everyone and edit members without leaving the page.', ar: 'العائلة تجمع أشخاصاً في منزل واحد. يُحسب عدد الأفراد والهاتف من الأشخاص المرتبطين بها. اضغط على عائلة لرؤية الجميع وتعديل الأفراد.' }} />
<div class="mb-3 flex flex-wrap items-center gap-3">
  <input class="input max-w-xs" placeholder={$t('common.search')} bind:value={search} oninput={onSearch} />
  <label class="flex items-center gap-2 text-sm text-slate-500">
    <input type="checkbox" bind:checked={showEmpty} onchange={load} /> {tr({ en: 'Show empty families', ar: 'إظهار العائلات الفارغة' }, $locale)}
  </label>
</div>

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
    <td class="p-3 align-top font-medium">
      {#if editable}<a class="text-primary-700 hover:underline dark:text-primary-300" href="/families/{f.id}">{tr(f.name, $locale)}</a>{:else}{tr(f.name, $locale)}{/if}
      {#if (f.memberCount ?? 0) === 0 && can('delete household')}
        <button type="button" class="ms-2 text-xs font-normal text-rose-500 hover:underline disabled:opacity-50" disabled={deleting === f.id} onclick={() => deleteEmpty(f)}>{deleting === f.id ? '…' : `🗑 ${tr({ en: 'Delete empty', ar: 'حذف الفارغة' }, $locale)}`}</button>
      {/if}
    </td>
    <td class="p-3 align-top text-slate-600 dark:text-slate-300">
      {#if (f.memberCount ?? 0) > 0}
        <button type="button" class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800" aria-expanded={expanded.has(f.id)} onclick={() => toggleMembers(f)}>
          <span class="font-medium tabular-nums">{f.memberCount}</span>
          {#if f.childCount > 0}<span class="text-xs text-slate-400">({f.childCount} {tr({ en: 'children', ar: 'أطفال' }, $locale)})</span>{/if}
          <span class="text-slate-400 transition-transform {expanded.has(f.id) ? 'rotate-90' : ''}">›</span>
        </button>
        {#if expanded.has(f.id)}
          <div class="mt-2">
            {#if loadingMembers.has(f.id)}
              <p class="text-xs text-slate-400">{$t('common.loading')}</p>
            {:else}
              <ul class="space-y-1">
                {#each memberCache[f.id] ?? [] as m}
                  <li class="flex flex-wrap items-center gap-2 text-xs">
                    <a href="/members/{m.id}" class="text-primary-700 hover:underline dark:text-primary-300">{displayName(m, $nameOrder, $locale)}</a>
                    {#if m.householdRole}<span class="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] capitalize text-slate-500 dark:bg-slate-800 dark:text-slate-400">{isHead(m.householdRole) ? `👑 ${tr({ en: 'Head', ar: 'رب الأسرة' }, $locale)}` : m.householdRole}</span>{/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}
      {:else}
        <span class="text-slate-400">0</span>
      {/if}
    </td>
    <td class="p-3 force-ltr text-slate-600 dark:text-slate-300">{f.homePhone ?? '—'}</td>
    <td class="p-3 text-slate-600 dark:text-slate-300">{f.city ?? '—'}</td>
  {/snippet}
</DataTable>
