<script lang="ts">
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import { t, locale, tr, LOCALES } from '$lib/i18n.js';

  let { initial = null, id = null }: { initial?: any; id?: number | null } = $props();

  let form = $state({
    name: initial?.name ?? {},
    startsOn: initial?.startsOn ?? new Date().toISOString().slice(0, 10),
    endsOn: initial?.endsOn ?? '',
    venue: initial?.venue ?? '',
    capacity: initial?.capacity ?? '',
    fee: initial?.feeAmountMinor != null ? initial.feeAmountMinor / 100 : '',
    registrationOpen: initial?.registrationOpen ?? true,
  });
  let error = $state('');
  let saving = $state(false);

  async function submit(e: Event) {
    e.preventDefault();
    saving = true; error = '';
    try {
      const body = {
        name: form.name,
        startsOn: form.startsOn,
        endsOn: form.endsOn || null,
        venue: form.venue || null,
        capacity: form.capacity === '' ? null : Number(form.capacity),
        fee: form.fee === '' ? null : Number(form.fee),
        registrationOpen: form.registrationOpen,
      };
      if (id) await api(`/events/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      else await api('/events', { method: 'POST', body: JSON.stringify(body) });
      await goto('/events');
    } catch (err) { error = (err as Error).message; } finally { saving = false; }
  }
</script>

<form class="max-w-lg space-y-6" onsubmit={submit}>
  {#if error}<p class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>{/if}
  <div class="card space-y-4 p-6">
    {#each LOCALES as l}
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Name', ar: 'الاسم' }, $locale)} ({l.native})</span>
        <input class="input" dir={l.dir} bind:value={form.name[l.code]} required={l.code === 'en'} />
      </label>
    {/each}
    <div class="grid gap-3 sm:grid-cols-2">
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Starts', ar: 'يبدأ' }, $locale)}</span>
        <input class="input force-ltr" type="date" bind:value={form.startsOn} required />
      </label>
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Ends', ar: 'ينتهي' }, $locale)}</span>
        <input class="input force-ltr" type="date" bind:value={form.endsOn} />
      </label>
    </div>
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Venue', ar: 'المكان' }, $locale)}</span>
      <input class="input" bind:value={form.venue} />
    </label>
    <div class="grid gap-3 sm:grid-cols-2">
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Capacity', ar: 'السعة' }, $locale)}</span>
        <input class="input force-ltr" type="number" min="1" bind:value={form.capacity} />
      </label>
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Fee', ar: 'الرسوم' }, $locale)}</span>
        <input class="input force-ltr" type="number" min="0" step="0.01" bind:value={form.fee} />
      </label>
    </div>
    <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={form.registrationOpen} /> {tr({ en: 'Registration open', ar: 'التسجيل مفتوح' }, $locale)}</label>
  </div>
  <div class="flex gap-3">
    <button class="btn-primary" type="submit" disabled={saving}>{saving ? $t('common.loading') : $t('common.save')}</button>
    <a class="btn-ghost" href="/events">✕</a>
  </div>
</form>
