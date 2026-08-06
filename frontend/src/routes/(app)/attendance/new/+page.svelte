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

  // Recurring series (#19): create the same gathering on a repeating schedule.
  // 'none' keeps the original single-gathering behaviour.
  let repeat = $state({ frequency: 'none' as 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly', count: 8 });
  const FREQUENCIES = [
    { v: 'none', label: { en: "Doesn't repeat", ar: 'لا يتكرر' } },
    { v: 'daily', label: { en: 'Daily', ar: 'يومياً' } },
    { v: 'weekly', label: { en: 'Weekly', ar: 'أسبوعياً' } },
    { v: 'biweekly', label: { en: 'Every 2 weeks', ar: 'كل أسبوعين' } },
    { v: 'monthly', label: { en: 'Monthly', ar: 'شهرياً' } },
  ];

  onMount(async () => { ministries = (await api<{ data: any[] }>('/ministries')).data; });

  async function submit(e: Event) {
    e.preventDefault();
    saving = true; error = '';
    try {
      const serviceTypeId = form.serviceTypeId === '' ? null : Number(form.serviceTypeId);
      const startsAt = new Date(form.startsAt).toISOString();
      if (repeat.frequency === 'none') {
        const { data } = await api<{ data: any }>('/attendance/events', {
          method: 'POST',
          body: JSON.stringify({ title: form.title, serviceTypeId, startsAt }),
        });
        await goto(`/attendance/${data.id}`);
      } else {
        await api('/attendance/events/recurring', {
          method: 'POST',
          body: JSON.stringify({ title: form.title, serviceTypeId, startsAt, frequency: repeat.frequency, count: repeat.count }),
        });
        await goto('/attendance');
      }
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

    <div class="grid gap-4 sm:grid-cols-2">
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Repeat', ar: 'التكرار' }, $locale)}</span>
        <select class="input" bind:value={repeat.frequency}>
          {#each FREQUENCIES as f}<option value={f.v}>{tr(f.label, $locale)}</option>{/each}
        </select>
      </label>
      {#if repeat.frequency !== 'none'}
        <label class="block space-y-1">
          <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Number of occurrences', ar: 'عدد المرات' }, $locale)}</span>
          <input class="input force-ltr" type="number" min="2" max="52" bind:value={repeat.count} required />
        </label>
      {/if}
    </div>
    {#if repeat.frequency !== 'none'}
      <p class="text-xs text-slate-500 dark:text-slate-400">
        {tr({ en: `Creates ${repeat.count} gatherings starting from the date above. Each can be edited or deleted individually.`, ar: `يُنشئ ${repeat.count} اجتماعاً بدءاً من التاريخ أعلاه. يمكن تعديل أو حذف كل منها على حدة.` }, $locale)}
      </p>
    {/if}
  </div>
  <div class="flex gap-3">
    <button class="btn-primary" type="submit" disabled={saving}>{saving ? $t('common.loading') : repeat.frequency === 'none' ? $t('common.save') : tr({ en: `Create ${repeat.count} gatherings`, ar: `إنشاء ${repeat.count} اجتماع` }, $locale)}</button>
    <a class="btn-ghost" href="/attendance">✕</a>
  </div>
</form>
