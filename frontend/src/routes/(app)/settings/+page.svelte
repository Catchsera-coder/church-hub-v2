<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { t, locale, tr, LOCALES } from '$lib/i18n.js';
  import PageHeader from '$lib/components/PageHeader.svelte';

  let form = $state<any>(null);
  let saving = $state(false);
  let saved = $state(false);

  onMount(async () => {
    const r = await api<{ data: any }>('/settings');
    form = { ...r.data, name: r.data.name ?? {} };
  });

  async function save(e: Event) {
    e.preventDefault();
    saving = true; saved = false;
    try {
      await api('/settings', { method: 'PUT', body: JSON.stringify({
        name: form.name, currency: form.currency, timezone: form.timezone, locale: form.locale,
        email: form.email, phone: form.phone, addressLine1: form.addressLine1, city: form.city,
        region: form.region, postalCode: form.postalCode, country: form.country,
      }) });
      saved = true;
    } finally { saving = false; }
  }
</script>

<PageHeader title={$t('nav.settings')} />

{#if !form}
  <p class="text-slate-400">{$t('common.loading')}</p>
{:else}
  <form class="max-w-2xl space-y-6" onsubmit={save}>
    <div class="card space-y-4 p-6">
      <h2 class="text-lg font-semibold">{tr({ en: 'Identity', ar: 'الهوية' }, $locale)}</h2>
      {#each LOCALES as l}
        <label class="block space-y-1">
          <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Church name', ar: 'اسم الكنيسة' }, $locale)} ({l.native})</span>
          <input class="input" dir={l.dir} bind:value={form.name[l.code]} />
        </label>
      {/each}
    </div>

    <div class="card grid gap-4 p-6 sm:grid-cols-3">
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Default language', ar: 'اللغة الافتراضية' }, $locale)}</span>
        <select class="input" bind:value={form.locale}>{#each LOCALES as l}<option value={l.code}>{l.native}</option>{/each}</select>
      </label>
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Currency', ar: 'العملة' }, $locale)}</span>
        <input class="input force-ltr uppercase" maxlength="3" bind:value={form.currency} />
      </label>
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Time zone', ar: 'المنطقة الزمنية' }, $locale)}</span>
        <input class="input force-ltr" bind:value={form.timezone} />
      </label>
    </div>

    <div class="card grid gap-4 p-6 sm:grid-cols-2">
      <h2 class="text-lg font-semibold sm:col-span-2">{tr({ en: 'Contact', ar: 'التواصل' }, $locale)}</h2>
      <label class="block space-y-1"><span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Email', ar: 'البريد' }, $locale)}</span><input class="input force-ltr" bind:value={form.email} /></label>
      <label class="block space-y-1"><span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Phone', ar: 'الهاتف' }, $locale)}</span><input class="input force-ltr" bind:value={form.phone} /></label>
      <label class="block space-y-1"><span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Address', ar: 'العنوان' }, $locale)}</span><input class="input" bind:value={form.addressLine1} /></label>
      <label class="block space-y-1"><span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'City', ar: 'المدينة' }, $locale)}</span><input class="input" bind:value={form.city} /></label>
    </div>

    <div class="flex items-center gap-3">
      <button class="btn-primary" type="submit" disabled={saving}>{saving ? $t('common.loading') : $t('common.save')}</button>
      {#if saved}<span class="text-sm text-emerald-600 dark:text-emerald-400">✓</span>{/if}
    </div>
  </form>
{/if}
