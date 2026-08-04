<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import DataTable from '$lib/components/DataTable.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';

  let rows = $state<any[]>([]);
  let loading = $state(true);
  let search = $state('');
  let timer: ReturnType<typeof setTimeout>;

  async function load() {
    loading = true;
    try {
      const q = new URLSearchParams({ limit: '50' });
      if (search.trim()) q.set('search', search.trim());
      rows = (await api<{ data: any[] }>(`/families?${q}`)).data;
    } finally {
      loading = false;
    }
  }
  function onSearch() { clearTimeout(timer); timer = setTimeout(load, 300); }
  onMount(load);
</script>

<PageHeader title={$t('nav.families')} />
<div class="mb-4"><input class="input max-w-xs" placeholder={$t('common.search')} bind:value={search} oninput={onSearch} /></div>

<DataTable {loading} {rows} headers={[tr({ en: 'Family', ar: 'العائلة' }, $locale), tr({ en: 'Phone', ar: 'الهاتف' }, $locale), tr({ en: 'City', ar: 'المدينة' }, $locale)]}>
  {#snippet row(f)}
    <td class="p-3 font-medium">{tr(f.name, $locale)}</td>
    <td class="p-3 force-ltr text-slate-600 dark:text-slate-300">{f.homePhone ?? '—'}</td>
    <td class="p-3 text-slate-600 dark:text-slate-300">{f.city ?? '—'}</td>
  {/snippet}
</DataTable>
