<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import PageHint from '$lib/components/PageHint.svelte';

  let forms = $state<any[]>([]);
  let loading = $state(true);
  let creating = $state(false);

  async function load() {
    loading = true;
    try { forms = (await api<{ data: any[] }>('/checkin-forms')).data; }
    finally { loading = false; }
  }
  onMount(load);

  async function create() {
    creating = true;
    try {
      const { data } = await api<{ data: any }>('/checkin-forms', {
        method: 'POST',
        body: JSON.stringify({
          name: { en: 'New form' },
          fields: [
            { key: 'givenName', label: { en: 'First name', ar: 'الاسم الأول' }, type: 'text', required: true, forWhom: 'all' },
            { key: 'mobile', label: { en: 'Mobile', ar: 'الجوال' }, type: 'tel', required: true, forWhom: 'primary' },
          ],
        }),
      });
      await goto(`/forms/${data.id}`);
    } finally { creating = false; }
  }
</script>

<PageHeader title={tr({ en: 'Forms', ar: 'النماذج' }, $locale)}>
  {#snippet actions()}
    <button class="btn-primary" onclick={create} disabled={creating}>{creating ? $t('common.loading') : $t('common.new')}</button>
  {/snippet}
</PageHeader>
<PageHint id="forms" text={{ en: 'Build shareable connect / registration forms. Choose fields, mark which are required, then share the link or QR — submissions arrive as people flagged for review.', ar: 'أنشئ نماذج تعارف / تسجيل قابلة للمشاركة. اختر الحقول، وحدّد المطلوب منها، ثم شارك الرابط أو رمز QR — تصل الردود كأشخاص بانتظار المراجعة.' }} />

<p class="mb-4 text-sm text-slate-500 dark:text-slate-400">{tr({ en: 'Build shareable connect / registration forms. Share the link or QR anywhere; submissions are added to Members, flagged for review.', ar: 'أنشئ نماذج تعارف/تسجيل قابلة للمشاركة. شارك الرابط أو رمز QR في أي مكان؛ تُضاف الردود إلى الأعضاء مع وضع علامة للمراجعة.' }, $locale)}</p>

<div class="card overflow-hidden">
  {#if loading}
    <p class="p-6 text-slate-400">{$t('common.loading')}</p>
  {:else if forms.length === 0}
    <p class="p-8 text-center text-slate-500">{tr({ en: 'No forms yet.', ar: 'لا توجد نماذج بعد.' }, $locale)}</p>
  {:else}
    <table class="w-full text-sm">
      <thead class="border-b border-slate-200 text-start text-slate-500 dark:border-slate-800">
        <tr>
          <th class="p-3 text-start font-medium">{tr({ en: 'Name', ar: 'الاسم' }, $locale)}</th>
          <th class="p-3 text-start font-medium">{tr({ en: 'Fields', ar: 'الحقول' }, $locale)}</th>
          <th class="p-3 text-start font-medium">{tr({ en: 'Status', ar: 'الحالة' }, $locale)}</th>
        </tr>
      </thead>
      <tbody>
        {#each forms as f}
          <tr class="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
            <td class="p-3">
              <a class="font-medium text-primary-700 hover:underline dark:text-primary-300" href="/forms/{f.id}">{tr(f.name, $locale) || `#${f.id}`}</a>
              {#if f.isDefault}<span class="ms-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{tr({ en: 'default', ar: 'افتراضي' }, $locale)}</span>{/if}
            </td>
            <td class="p-3 text-slate-600 dark:text-slate-300">{(f.fields ?? []).length}</td>
            <td class="p-3">
              {#if f.active}<span class="text-emerald-600 dark:text-emerald-400">● {tr({ en: 'Active', ar: 'مفعّل' }, $locale)}</span>{:else}<span class="text-slate-400">○ {tr({ en: 'Off', ar: 'متوقف' }, $locale)}</span>{/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
