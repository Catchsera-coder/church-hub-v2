<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import { can } from '$lib/stores/auth.js';
  import DataTable from '$lib/components/DataTable.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import PageHint from '$lib/components/PageHint.svelte';

  let rows = $state<any[]>([]);
  let loading = $state(true);

  async function load() {
    loading = true;
    try { rows = (await api<{ data: any[] }>('/message-templates')).data; } finally { loading = false; }
  }
  onMount(load);

  async function remove(m: any) {
    if (!confirm(tr({ en: `Delete template "${m.name}"?`, ar: `حذف القالب «${m.name}»؟` }, $locale))) return;
    try {
      await api(`/message-templates/${m.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : (err as Error).message);
    }
  }
</script>

<PageHeader title={tr({ en: 'Message templates', ar: 'قوالب الرسائل' }, $locale)}>
  {#snippet actions()}
    <a href="/messages" class="btn-ghost">{tr({ en: 'Messages', ar: 'الرسائل' }, $locale)}</a>
    {#if can('create message')}<a href="/messages/templates/new" class="btn-primary">{$t('common.new')}</a>{/if}
  {/snippet}
</PageHeader>
<PageHint id="templates" text={{ en: 'Reusable, branded message templates with merge fields ({{firstName}} etc.). Create one here, then start a message from it — automations use these too.', ar: 'قوالب رسائل جاهزة بعلامتكم وبحقول دمج ({{firstName}} إلخ). أنشئ قالباً ثم ابدأ رسالة منه — والأتمتة تستخدمها أيضاً.' }} />

<DataTable {loading} {rows} empty={tr({ en: 'No templates yet — create one to reuse branded copy across campaigns.', ar: 'لا توجد قوالب بعد — أنشئ قالباً لإعادة استخدام نص موحّد عبر الحملات.' }, $locale)}
  headers={[tr({ en: 'Name', ar: 'الاسم' }, $locale), tr({ en: 'Channel', ar: 'القناة' }, $locale), tr({ en: 'Subject', ar: 'الموضوع' }, $locale), tr({ en: 'Status', ar: 'الحالة' }, $locale), '']}>
  {#snippet row(m)}
    <td class="p-3 font-medium">
      {#if can('update message')}<a class="text-primary-600 hover:underline dark:text-primary-300" href="/messages/templates/{m.id}">{m.name}</a>{:else}{m.name}{/if}
    </td>
    <td class="p-3 uppercase text-xs text-slate-500">{m.channel}</td>
    <td class="p-3 text-slate-600 dark:text-slate-300">{tr(m.subject, $locale) || '—'}</td>
    <td class="p-3 text-xs {m.isActive ? 'text-emerald-600' : 'text-slate-400'}">{m.isActive ? tr({ en: 'Active', ar: 'مُفعّل' }, $locale) : tr({ en: 'Inactive', ar: 'معطّل' }, $locale)}</td>
    <td class="p-3 text-end">
      {#if can('delete message')}
        <button class="text-xs text-rose-600 hover:underline dark:text-rose-400" onclick={() => remove(m)}>{$t('common.delete')}</button>
      {/if}
    </td>
  {/snippet}
</DataTable>
