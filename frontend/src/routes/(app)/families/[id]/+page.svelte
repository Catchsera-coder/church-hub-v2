<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import { t, tr, locale } from '$lib/i18n.js';
  import { can } from '$lib/stores/auth.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import FamilyForm from '$lib/components/FamilyForm.svelte';
  import FamilyMembers from '$lib/components/FamilyMembers.svelte';

  const id = Number($page.params.id);
  let family = $state<any>(null);
  const canMessage = can('create message');
  onMount(async () => { family = (await api<{ data: any }>(`/families/${id}`)).data; });

  // Open the composer pre-targeted to everyone in this family.
  async function messageFamily() {
    const members = (await api<{ data: any[] }>(`/families/${id}/members`)).data;
    const ids = members.map((m) => m.id);
    if (!ids.length) return;
    await goto(`/messages/new?people=${ids.join(',')}`);
  }
</script>

<PageHeader title={tr({ en: 'Edit family', ar: 'تعديل العائلة' }, $locale)} back="/families">
  {#snippet actions()}
    {#if canMessage}
      <button class="btn-ghost border border-slate-300 text-sm dark:border-slate-700" onclick={messageFamily}>✉️ {tr({ en: 'Message this family', ar: 'راسل هذه العائلة' }, $locale)}</button>
    {/if}
  {/snippet}
</PageHeader>
{#if family}
  <div class="max-w-2xl space-y-6">
    <FamilyForm initial={family} {id} />
    <FamilyMembers householdId={id} />
  </div>
{:else}<p class="text-slate-400">{$t('common.loading')}</p>{/if}
