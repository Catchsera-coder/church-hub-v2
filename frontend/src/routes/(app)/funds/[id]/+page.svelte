<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api } from '$lib/api.js';
  import { t, tr, locale } from '$lib/i18n.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import FundForm from '$lib/components/FundForm.svelte';

  const id = Number($page.params.id);
  let fund = $state<any>(null);
  // No GET /funds/:id endpoint (funds are few) — fetch the list and pick it out.
  onMount(async () => {
    const all = (await api<{ data: any[] }>('/funds')).data;
    fund = all.find((f) => f.id === id) ?? null;
  });
</script>

<PageHeader title={tr({ en: 'Edit fund', ar: 'تعديل الصندوق' }, $locale)} />
{#if fund}<FundForm initial={fund} {id} />{:else}<p class="text-slate-400">{$t('common.loading')}</p>{/if}
