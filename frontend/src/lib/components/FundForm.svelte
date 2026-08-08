<script lang="ts">
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import { t, locale, tr, enabledLocales } from '$lib/i18n.js';

  let { initial = null, id = null }: { initial?: any; id?: number | null } = $props();

  let form = $state({
    code: initial?.code ?? '',
    name: initial?.name ?? {},
    isTaxDeductible: initial?.isTaxDeductible ?? true,
    isActive: initial?.isActive ?? true,
    sortOrder: initial?.sortOrder ?? 0,
  });
  let error = $state('');
  let saving = $state(false);

  async function submit(e: Event) {
    e.preventDefault();
    saving = true; error = '';
    try {
      const body = { ...form, code: form.code.toUpperCase(), sortOrder: Number(form.sortOrder) };
      if (id) await api(`/funds/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      else await api('/funds', { method: 'POST', body: JSON.stringify(body) });
      await goto('/funds');
    } catch (err) { error = (err as Error).message; } finally { saving = false; }
  }
</script>

<form class="max-w-lg space-y-6" onsubmit={submit}>
  {#if error}<p class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>{/if}
  <div class="card space-y-4 p-6">
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Code', ar: 'الرمز' }, $locale)}</span>
      <input class="input force-ltr uppercase" bind:value={form.code} required maxlength="32" />
    </label>
    {#each $enabledLocales as l}
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Name', ar: 'الاسم' }, $locale)} ({l.native})</span>
        <input class="input" dir={l.dir} bind:value={form.name[l.code]} />
      </label>
    {/each}
    <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={form.isTaxDeductible} /> {tr({ en: 'Tax-deductible', ar: 'معفى ضريبياً' }, $locale)}</label>
    <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={form.isActive} /> {tr({ en: 'Active', ar: 'مُفعّل' }, $locale)}</label>
  </div>
  <div class="flex gap-3">
    <button class="btn-primary" type="submit" disabled={saving}>{saving ? $t('common.loading') : $t('common.save')}</button>
    <a class="btn-ghost" href="/funds">✕</a>
  </div>
</form>
