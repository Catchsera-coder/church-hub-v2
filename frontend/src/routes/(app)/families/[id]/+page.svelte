<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api } from '$lib/api.js';
  import { t, tr, locale } from '$lib/i18n.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import FamilyForm from '$lib/components/FamilyForm.svelte';

  const id = Number($page.params.id);
  let family = $state<any>(null);
  onMount(async () => { family = (await api<{ data: any }>(`/families/${id}`)).data; });
</script>

<PageHeader title={tr({ en: 'Edit family', ar: 'تعديل العائلة' }, $locale)} />
{#if family}<FamilyForm initial={family} {id} />{:else}<p class="text-slate-400">{$t('common.loading')}</p>{/if}
