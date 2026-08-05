<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import { dateTime } from '$lib/format.js';
  import { can } from '$lib/stores/auth.js';
  import DataTable from '$lib/components/DataTable.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';

  let rows = $state<any[]>([]);
  let loading = $state(true);
  onMount(async () => { try { rows = (await api<{ data: any[] }>('/attendance/events')).data; } finally { loading = false; } });
</script>

<PageHeader title={$t('nav.attendance')}>
  {#snippet actions()}
    {#if can('create attendance')}<a href="/attendance/new" class="btn-primary">{$t('common.new')}</a>{/if}
  {/snippet}
</PageHeader>
<DataTable {loading} {rows} headers={[tr({ en: 'Gathering', ar: 'الاجتماع' }, $locale), tr({ en: 'Starts', ar: 'يبدأ' }, $locale)]}>
  {#snippet row(e)}
    <td class="p-3 font-medium">
      <a class="text-primary-700 hover:underline dark:text-primary-300" href="/attendance/{e.id}">{tr(e.title, $locale) || '—'}</a>
    </td>
    <td class="p-3 force-ltr text-slate-600 dark:text-slate-300">{dateTime(e.startsAt)}</td>
  {/snippet}
</DataTable>
