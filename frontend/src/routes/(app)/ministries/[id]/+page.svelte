<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api } from '$lib/api.js';
  import { t, tr, locale } from '$lib/i18n.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import MinistryForm from '$lib/components/MinistryForm.svelte';

  const id = Number($page.params.id);
  let ministry = $state<any>(null);
  // No GET /ministries/:id endpoint (ministries are few) — fetch the list and pick it out.
  onMount(async () => {
    const all = (await api<{ data: any[] }>('/ministries')).data;
    ministry = all.find((m) => m.id === id) ?? null;
  });
</script>

<PageHeader title={tr({ en: 'Edit ministry', ar: 'تعديل الخدمة' }, $locale)} />
{#if ministry}<MinistryForm initial={ministry} {id} />{:else}<p class="text-slate-400">{$t('common.loading')}</p>{/if}
