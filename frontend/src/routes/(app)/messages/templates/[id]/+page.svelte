<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import MessageTemplateForm from '$lib/components/MessageTemplateForm.svelte';

  let template = $state<any>(null);
  let id = $state<number>(Number($page.params.id));

  onMount(async () => {
    template = (await api<{ data: any }>(`/message-templates/${id}`)).data;
  });
</script>

<PageHeader title={tr({ en: 'Edit template', ar: 'تعديل القالب' }, $locale)} />
{#if template}
  <MessageTemplateForm initial={template} {id} />
{:else}
  <p class="text-slate-400">{$t('common.loading')}</p>
{/if}
