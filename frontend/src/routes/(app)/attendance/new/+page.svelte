<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import { t, locale, tr, LOCALES } from '$lib/i18n.js';
  import PageHeader from '$lib/components/PageHeader.svelte';

  let ministries = $state<any[]>([]);
  let error = $state('');
  let saving = $state(false);

  function nowLocal() {
    // datetime-local wants YYYY-MM-DDTHH:mm; default to the next hour, this device's clock.
    const d = new Date();
    d.setMinutes(0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  let form = $state({
    title: {} as Record<string, string>,
    serviceTypeId: '' as string,
    startsAt: nowLocal(),
  });

  onMount(async () => { ministries = (await api<{ data: any[] }>('/ministries')).data; });

  async function submit(e: Event) {
    e.preventDefault();
    saving = true; error = '';
    try {
      const { data } = await api<{ data: any }>('/attendance/events', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title,
          serviceTypeId: form.serviceTypeId === '' ? null : Number(form.serviceTypeId),
          startsAt: new Date(form.startsAt).toISOString(),
        }),
      });
      await goto(`/attendance/${data.id}`);
    } catch (err) { error = (err as Error).message; } finally { saving = false; }
  }
</script>

<PageHeader title={tr({ en: 'New gathering', ar: 'اجتماع جديد' }, $locale)} />

<form class="max-w-lg space-y-6" onsubmit={submit}>
  {#if error}<p class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>{/if}
  <div class="card space-y-4 p-6">
    {#each LOCALES as l}
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Title', ar: 'العنوان' }, $locale)} ({l.native})</span>
        <input class="input" dir={l.dir} bind:value={form.title[l.code]} required={l.code === 'en'} placeholder={tr({ en: 'e.g. Sunday service', ar: 'مثال: خدمة الأحد' }, $locale)} />
      </label>
    {/each}
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Ministry', ar: 'الخدمة' }, $locale)}</span>
      <select class="input" bind:value={form.serviceTypeId}>
        <option value="">{tr({ en: '— General —', ar: '— عام —' }, $locale)}</option>
        {#each ministries as m}<option value={String(m.id)}>{tr(m.name, $locale)}</option>{/each}
      </select>
    </label>
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Starts at', ar: 'يبدأ في' }, $locale)}</span>
      <input class="input force-ltr" type="datetime-local" bind:value={form.startsAt} required />
    </label>
  </div>
  <div class="flex gap-3">
    <button class="btn-primary" type="submit" disabled={saving}>{saving ? $t('common.loading') : $t('common.save')}</button>
    <a class="btn-ghost" href="/attendance">✕</a>
  </div>
</form>
