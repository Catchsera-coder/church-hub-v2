<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api } from '$lib/api.js';
  import { t, tr, locale } from '$lib/i18n.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import MemberForm from '$lib/components/MemberForm.svelte';
  import RosterEditor from '$lib/components/RosterEditor.svelte';
  import MemberClearances from '$lib/components/MemberClearances.svelte';
  import MemberQrCard from '$lib/components/MemberQrCard.svelte';

  let person = $state<any>(null);
  let id = $state<number>(Number($page.params.id));

  onMount(async () => {
    person = (await api<{ data: any }>(`/people/${id}`)).data;
  });
</script>

<PageHeader title={`${tr({ en: 'Edit member', ar: 'تعديل العضو' }, $locale)} · #${id}`} back="/members">
  {#snippet actions()}
    {#if person?.householdId}
      <a class="btn-ghost border border-slate-300 text-sm dark:border-slate-700" href="/families/{person.householdId}">👪 {tr({ en: 'Open family', ar: 'فتح العائلة' }, $locale)}</a>
    {/if}
  {/snippet}
</PageHeader>
{#if person}
  <div class="grid gap-6 lg:grid-cols-5 lg:items-start">
    <div class="lg:col-span-3"><MemberForm initial={person} {id} /></div>
    <div class="space-y-6 lg:col-span-2">
      <RosterEditor personId={id} />
      <MemberClearances personId={id} />
      {#if person.qrToken}
        <MemberQrCard qrToken={person.qrToken} name={`${tr(person.givenName, $locale)} ${tr(person.familyName, $locale)}`.trim()} />
      {/if}
    </div>
  </div>
{:else}
  <p class="text-slate-400">{$t('common.loading')}</p>
{/if}
