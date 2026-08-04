<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import { dateTime } from '$lib/format.js';
  import DataTable from '$lib/components/DataTable.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';

  let rows = $state<any[]>([]);
  let loading = $state(true);
  onMount(async () => { try { rows = (await api<{ data: any[] }>('/team')).data; } finally { loading = false; } });
</script>

<PageHeader title={$t('nav.team')} />
<DataTable {loading} {rows} headers={[tr({ en: 'Name', ar: 'الاسم' }, $locale), tr({ en: 'Email', ar: 'البريد' }, $locale), tr({ en: 'Roles', ar: 'الأدوار' }, $locale), tr({ en: 'Status', ar: 'الحالة' }, $locale), tr({ en: 'Last sign-in', ar: 'آخر دخول' }, $locale)]}>
  {#snippet row(u)}
    <td class="p-3 font-medium">{u.name}</td>
    <td class="p-3 force-ltr text-slate-600 dark:text-slate-300">{u.email}</td>
    <td class="p-3 text-slate-600 dark:text-slate-300">{(u.roles ?? []).join(', ') || '—'}</td>
    <td class="p-3">
      {#if u.invitedAt && !u.lastLoginAt}
        <span class="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">{tr({ en: 'Invited', ar: 'مدعو' }, $locale)}</span>
      {:else if u.isActive}
        <span class="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">{tr({ en: 'Active', ar: 'نشط' }, $locale)}</span>
      {:else}
        <span class="rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">{tr({ en: 'Inactive', ar: 'غير نشط' }, $locale)}</span>
      {/if}
    </td>
    <td class="p-3 force-ltr text-slate-600 dark:text-slate-300">{u.lastLoginAt ? dateTime(u.lastLoginAt) : '—'}</td>
  {/snippet}
</DataTable>
