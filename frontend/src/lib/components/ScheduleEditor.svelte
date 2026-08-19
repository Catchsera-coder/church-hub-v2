<script lang="ts">
  // Reusable schedule editor — once vs recurring, frequency, time-of-day, days,
  // start/end. Used by automations, campaigns, and stream-link sends. Binds a
  // Schedule object; the parent persists it.
  import { tr, locale } from '$lib/i18n.js';
  import { type Schedule, describeSchedule } from '$lib/schedule.js';

  let { schedule = $bindable(), showOnce = true }: { schedule: Schedule; showOnce?: boolean } = $props();

  const DOW = [
    { v: 0, l: { en: 'Sun', ar: 'أحد' } },
    { v: 1, l: { en: 'Mon', ar: 'إثن' } },
    { v: 2, l: { en: 'Tue', ar: 'ثلا' } },
    { v: 3, l: { en: 'Wed', ar: 'أرب' } },
    { v: 4, l: { en: 'Thu', ar: 'خمي' } },
    { v: 5, l: { en: 'Fri', ar: 'جمع' } },
    { v: 6, l: { en: 'Sat', ar: 'سبت' } },
  ];

  function toggleDay(d: number) {
    const s = new Set(schedule.daysOfWeek ?? []);
    if (s.has(d)) s.delete(d); else s.add(d);
    schedule.daysOfWeek = [...s].sort((a, b) => a - b);
  }
  const dayActive = (d: number) => (schedule.daysOfWeek ?? []).includes(d);
</script>

<div class="space-y-3">
  {#if showOnce}
    <div class="flex gap-2">
      <button type="button" class="rounded-md border px-3 py-1.5 text-sm {schedule.mode === 'recurring' ? 'border-transparent text-white' : 'border-slate-300 dark:border-slate-700'}" style={schedule.mode === 'recurring' ? 'background: var(--brand)' : ''} onclick={() => (schedule.mode = 'recurring')}>{tr({ en: 'Recurring', ar: 'متكرر' }, $locale)}</button>
      <button type="button" class="rounded-md border px-3 py-1.5 text-sm {schedule.mode === 'once' ? 'border-transparent text-white' : 'border-slate-300 dark:border-slate-700'}" style={schedule.mode === 'once' ? 'background: var(--brand)' : ''} onclick={() => (schedule.mode = 'once')}>{tr({ en: 'Once', ar: 'مرة واحدة' }, $locale)}</button>
    </div>
  {/if}

  {#if schedule.mode === 'once'}
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Date & time', ar: 'التاريخ والوقت' }, $locale)}</span>
      <input class="input force-ltr max-w-xs" type="datetime-local"
        value={schedule.at ? new Date(schedule.at).toISOString().slice(0, 16) : ''}
        onchange={(e) => { const v = (e.currentTarget as HTMLInputElement).value; schedule.at = v ? new Date(v).toISOString() : null; }} />
    </label>
  {:else}
    <div class="grid gap-3 sm:grid-cols-2">
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'How often', ar: 'كم مرة' }, $locale)}</span>
        <select class="input" bind:value={schedule.frequency}>
          <option value="daily">{tr({ en: 'Every day', ar: 'كل يوم' }, $locale)}</option>
          <option value="weekly">{tr({ en: 'Weekly', ar: 'أسبوعياً' }, $locale)}</option>
          <option value="monthly">{tr({ en: 'Monthly', ar: 'شهرياً' }, $locale)}</option>
        </select>
      </label>
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Time of day', ar: 'وقت اليوم' }, $locale)}</span>
        <input class="input force-ltr" type="time" bind:value={schedule.time} />
      </label>
    </div>

    {#if schedule.frequency === 'weekly'}
      <div class="space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'On these days', ar: 'في هذه الأيام' }, $locale)}</span>
        <div class="flex flex-wrap gap-1">
          {#each DOW as d}
            <button type="button" class="h-9 w-11 rounded-md border text-xs {dayActive(d.v) ? 'border-transparent text-white' : 'border-slate-300 dark:border-slate-700'}" style={dayActive(d.v) ? 'background: var(--brand)' : ''} onclick={() => toggleDay(d.v)}>{tr(d.l, $locale)}</button>
          {/each}
        </div>
      </div>
    {/if}

    {#if schedule.frequency === 'monthly'}
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Day of month', ar: 'يوم الشهر' }, $locale)}</span>
        <input class="input force-ltr w-24" type="number" min="1" max="31" bind:value={schedule.dayOfMonth} />
      </label>
    {/if}

    <div class="grid gap-3 sm:grid-cols-2">
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Start date (optional)', ar: 'تاريخ البدء (اختياري)' }, $locale)}</span>
        <input class="input force-ltr" type="date" value={schedule.startDate ?? ''} onchange={(e) => (schedule.startDate = (e.currentTarget as HTMLInputElement).value || null)} />
      </label>
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'End date (optional)', ar: 'تاريخ الانتهاء (اختياري)' }, $locale)}</span>
        <input class="input force-ltr" type="date" value={schedule.endDate ?? ''} onchange={(e) => (schedule.endDate = (e.currentTarget as HTMLInputElement).value || null)} />
      </label>
    </div>

    <div class="space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">🌙 {tr({ en: 'Quiet hours — never send between (optional)', ar: 'ساعات الهدوء — لا ترسل بين (اختياري)' }, $locale)}</span>
      <div class="flex items-center gap-2">
        <input class="input force-ltr w-28" type="time" value={schedule.quietStart ?? ''} onchange={(e) => (schedule.quietStart = (e.currentTarget as HTMLInputElement).value || undefined)} />
        <span class="text-slate-400">–</span>
        <input class="input force-ltr w-28" type="time" value={schedule.quietEnd ?? ''} onchange={(e) => (schedule.quietEnd = (e.currentTarget as HTMLInputElement).value || undefined)} />
      </div>
    </div>
  {/if}

  <p class="text-xs text-slate-500 dark:text-slate-400">🕑 {describeSchedule(schedule)}</p>
</div>
