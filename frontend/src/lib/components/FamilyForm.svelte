<script lang="ts">
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import { t, locale, tr, enabledLocales } from '$lib/i18n.js';

  let { initial = null, id = null }: { initial?: any; id?: number | null } = $props();

  let form = $state({
    name: initial?.name ?? {},
    homePhone: initial?.homePhone ?? '',
    addressLine1: initial?.addressLine1 ?? '',
    addressLine2: initial?.addressLine2 ?? '',
    city: initial?.city ?? '',
    region: initial?.region ?? '',
    postalCode: initial?.postalCode ?? '',
    country: initial?.country ?? '',
  });
  let error = $state('');
  let saving = $state(false);

  async function submit(e: Event) {
    e.preventDefault();
    saving = true; error = '';
    try {
      const body = Object.fromEntries(
        Object.entries(form).map(([k, v]) => [k, k === 'name' ? v : (v || null)]),
      );
      if (id) await api(`/families/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      else await api('/families', { method: 'POST', body: JSON.stringify(body) });
      await goto('/families');
    } catch (err) { error = (err as Error).message; } finally { saving = false; }
  }
</script>

<form class="w-full space-y-6" onsubmit={submit}>
  {#if error}<p class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>{/if}

  <div class="card grid gap-4 p-6 sm:grid-cols-2">
    {#each $enabledLocales as l}
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Family name', ar: 'اسم العائلة' }, $locale)} ({l.native})</span>
        <input class="input" dir={l.dir} bind:value={form.name[l.code]} required={l.code === 'en'} />
      </label>
    {/each}
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Home phone', ar: 'هاتف المنزل' }, $locale)}</span>
      <input class="input force-ltr" bind:value={form.homePhone} />
    </label>
  </div>

  <div class="card grid gap-4 p-6 sm:grid-cols-2">
    <label class="block space-y-1 sm:col-span-2">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Address line 1', ar: 'العنوان ١' }, $locale)}</span>
      <input class="input" bind:value={form.addressLine1} />
    </label>
    <label class="block space-y-1 sm:col-span-2">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Address line 2', ar: 'العنوان ٢' }, $locale)}</span>
      <input class="input" bind:value={form.addressLine2} />
    </label>
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'City', ar: 'المدينة' }, $locale)}</span>
      <input class="input" bind:value={form.city} />
    </label>
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Region', ar: 'المنطقة' }, $locale)}</span>
      <input class="input" bind:value={form.region} />
    </label>
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Postal code', ar: 'الرمز البريدي' }, $locale)}</span>
      <input class="input force-ltr" bind:value={form.postalCode} />
    </label>
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Country', ar: 'الدولة' }, $locale)}</span>
      <input class="input" bind:value={form.country} />
    </label>
  </div>

  <div class="flex gap-3">
    <button class="btn-primary" type="submit" disabled={saving}>{saving ? $t('common.loading') : $t('common.save')}</button>
    <a class="btn-ghost" href="/families">✕</a>
  </div>
</form>
