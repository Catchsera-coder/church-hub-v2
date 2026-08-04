<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api } from '$lib/api.js';
  import { t, tr, locale } from '$lib/i18n.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SermonForm from '$lib/components/SermonForm.svelte';

  const id = Number($page.params.id);
  let sermon = $state<any>(null);
  onMount(async () => {
    sermon = (await api<{ data: any }>(`/sermons/${id}`)).data;
  });
</script>

<PageHeader title={tr({ en: 'Edit sermon', ar: 'تعديل العظة' }, $locale)} />
{#if sermon}<SermonForm initial={sermon} {id} />{:else}<p class="text-slate-400">{$t('common.loading')}</p>{/if}
