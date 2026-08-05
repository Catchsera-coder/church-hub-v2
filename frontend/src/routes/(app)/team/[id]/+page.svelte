<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api } from '$lib/api.js';
  import { t, tr, locale } from '$lib/i18n.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import TeamMemberForm from '$lib/components/TeamMemberForm.svelte';

  const id = Number($page.params.id);
  let member = $state<any>(null);
  // No GET /team/:id — fetch the list and pick it out (roles come back as names).
  onMount(async () => {
    const all = (await api<{ data: any[] }>('/team')).data;
    member = all.find((u) => u.id === id) ?? null;
  });
</script>

<PageHeader title={tr({ en: 'Edit team member', ar: 'تعديل عضو الفريق' }, $locale)} />
{#if member}<TeamMemberForm initial={member} {id} />{:else}<p class="text-slate-400">{$t('common.loading')}</p>{/if}
