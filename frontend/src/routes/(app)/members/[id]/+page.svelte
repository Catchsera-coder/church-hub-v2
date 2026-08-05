<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api } from '$lib/api.js';
  import { t, tr, locale } from '$lib/i18n.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import MemberForm from '$lib/components/MemberForm.svelte';
  import RosterEditor from '$lib/components/RosterEditor.svelte';

  let person = $state<any>(null);
  let id = $state<number>(Number($page.params.id));

  onMount(async () => {
    person = (await api<{ data: any }>(`/people/${id}`)).data;
  });
</script>

<PageHeader title={tr({ en: 'Edit member', ar: 'تعديل العضو' }, $locale)} />
{#if person}
  <div class="space-y-6">
    <MemberForm initial={person} {id} />
    <div class="max-w-2xl"><RosterEditor personId={id} /></div>
  </div>
{:else}
  <p class="text-slate-400">{$t('common.loading')}</p>
{/if}
