<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import { t, locale, tr, enabledLocales } from '$lib/i18n.js';
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

  // Quick-name presets so a gathering is one tap to name (still fully editable).
  const PRESETS = [
    { en: 'Sunday Service', ar: 'خدمة الأحد' },
    { en: 'Prayer Meeting', ar: 'اجتماع صلاة' },
    { en: 'Bible Study', ar: 'دراسة كتاب' },
    { en: 'Youth Night', ar: 'ليلة الشباب' },
    { en: 'Kids Church', ar: 'كنيسة الأطفال' },
  ];
  function usePreset(p: Record<string, string>) {
    form.title = { ...form.title, en: p.en, ...(p.ar ? { ar: p.ar } : {}) };
  }

  // Live preview of exactly which dates a recurring series will create — so 20
  // occurrences never sneaks up on you.
  const previewDates = $derived.by(() => {
    if (repeat.frequency === 'none' || !form.startsAt) return [] as Date[];
    const first = new Date(form.startsAt);
    if (Number.isNaN(first.getTime())) return [] as Date[];
    const n = Math.min(repeat.count, 6);
    return Array.from({ length: n }, (_, i) => {
      const d = new Date(first);
      if (repeat.frequency === 'monthly') { d.setDate(1); d.setMonth(first.getMonth() + i); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(first.getDate(), last)); }
      else d.setDate(first.getDate() + i * (repeat.frequency === 'weekly' ? 7 : repeat.frequency === 'biweekly' ? 14 : 1));
      return d;
    });
  });
  const fmtDate = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

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

<PageHeader title={tr({ en: 'New gathering', ar: 'اجتماع جديد' }, $locale)} back="/attendance" />

<form class="max-w-lg space-y-6" onsubmit={submit}>
  {#if error}<p class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>{/if}
  <div class="card space-y-4 p-6">
    <div class="flex flex-wrap gap-2">
      {#each PRESETS as p}
        <button type="button" class="rounded-full border border-slate-300 px-3 py-1 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800" onclick={() => usePreset(p)}>{tr(p, $locale)}</button>
      {/each}
    </div>
    {#each $enabledLocales as l}
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
      <div class="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
        <p class="font-medium">⚠ {tr({ en: `This will create ${repeat.count} separate gatherings`, ar: `سيُنشئ هذا ${repeat.count} اجتماعاً منفصلاً` }, $locale)}</p>
        {#if previewDates.length}
          <p class="mt-1">{tr({ en: 'On:', ar: 'في:' }, $locale)} {previewDates.map(fmtDate).join(' · ')}{#if repeat.count > previewDates.length} … (+{repeat.count - previewDates.length}){/if}</p>
        {/if}
        <p class="mt-1 text-amber-700/80 dark:text-amber-300/80">{tr({ en: 'Want just one? Set Repeat to “Doesn’t repeat”.', ar: 'تريد واحداً فقط؟ اضبط التكرار على «لا يتكرر».' }, $locale)}</p>
      </div>
    {/if}
  </div>
  <div class="flex gap-3">
    <button class="btn-primary" type="submit" disabled={saving}>{saving ? $t('common.loading') : repeat.frequency === 'none' ? $t('common.save') : tr({ en: `Create ${repeat.count} gatherings`, ar: `إنشاء ${repeat.count} اجتماع` }, $locale)}</button>
    <a class="btn-ghost" href="/attendance">✕</a>
  </div>
</form>
