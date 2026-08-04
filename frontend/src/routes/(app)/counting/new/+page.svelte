<script lang="ts">
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import PageHeader from '$lib/components/PageHeader.svelte';

  let error = $state('');
  let saving = $state(false);
  let form = $state({
    name: `${tr({ en: 'Counting', ar: 'عدّ' }, 'en')} ${new Date().toISOString().slice(0, 10)}`,
    receivedOn: new Date().toISOString().slice(0, 10),
    expected: '' as string,
    notes: '',
  });

  async function submit(e: Event) {
    e.preventDefault();
    saving = true; error = '';
    try {
      await api('/batches', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          receivedOn: form.receivedOn,
          expectedTotalCents: form.expected ? Math.round(Number(form.expected) * 100) : null,
          notes: form.notes || null,
        }),
      });
      await goto('/counting');
    } catch (err) { error = (err as Error).message; } finally { saving = false; }
  }
</script>

<PageHeader title={tr({ en: 'New counting session', ar: 'جلسة عدّ جديدة' }, $locale)} />

<form class="max-w-lg space-y-6" onsubmit={submit}>
  {#if error}<p class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>{/if}
  <div class="card space-y-4 p-6">
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Session name', ar: 'اسم الجلسة' }, $locale)}</span>
      <input class="input" bind:value={form.name} required />
    </label>
    <div class="grid grid-cols-2 gap-4">
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Received on', ar: 'تاريخ الاستلام' }, $locale)}</span>
        <input class="input force-ltr" type="date" bind:value={form.receivedOn} required />
      </label>
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Counted total', ar: 'الإجمالي المعدود' }, $locale)}</span>
        <input class="input force-ltr" type="number" step="0.01" min="0" bind:value={form.expected} />
      </label>
    </div>
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Notes', ar: 'ملاحظات' }, $locale)}</span>
      <textarea class="input" rows="2" bind:value={form.notes}></textarea>
    </label>
  </div>
  <div class="flex gap-3">
    <button class="btn-primary" type="submit" disabled={saving}>{saving ? $t('common.loading') : $t('common.save')}</button>
    <a class="btn-ghost" href="/counting">✕</a>
  </div>
</form>
