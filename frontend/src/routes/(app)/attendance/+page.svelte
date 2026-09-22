<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import { dateTime } from '$lib/format.js';
  import { can, hasRole } from '$lib/stores/auth.js';
  import FilterBar from '$lib/components/FilterBar.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import PageHint from '$lib/components/PageHint.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

  const isSuper = hasRole('Super Admin');
  let rows = $state<any[]>([]);
  let loading = $state(true);
  let ministries = $state<{ id: number; name: Record<string, string> }[]>([]);

  // How to categorize: by gathering (default — "Sunday Worship" etc.), by weekday
  // (a "Sunday" category with all its dates), or by month.
  let groupBy = $state<'gathering' | 'weekday' | 'month'>('gathering');

  const EMPTY = { q: '', year: '', month: '', dow: '', serviceTypeId: '', from: '', to: '' };
  let f = $state({ ...EMPTY });
  const activeCount = $derived(Object.values(f).filter((v) => v !== '').length);

  const YEARS = Array.from({ length: new Date().getFullYear() - 2014 }, (_, i) => new Date().getFullYear() - i);
  const MONTHS = [
    { v: 1, en: 'January', ar: 'يناير' }, { v: 2, en: 'February', ar: 'فبراير' }, { v: 3, en: 'March', ar: 'مارس' },
    { v: 4, en: 'April', ar: 'أبريل' }, { v: 5, en: 'May', ar: 'مايو' }, { v: 6, en: 'June', ar: 'يونيو' },
    { v: 7, en: 'July', ar: 'يوليو' }, { v: 8, en: 'August', ar: 'أغسطس' }, { v: 9, en: 'September', ar: 'سبتمبر' },
    { v: 10, en: 'October', ar: 'أكتوبر' }, { v: 11, en: 'November', ar: 'نوفمبر' }, { v: 12, en: 'December', ar: 'ديسمبر' },
  ];
  const WEEKDAYS = [
    { v: 0, en: 'Sunday', ar: 'الأحد' }, { v: 1, en: 'Monday', ar: 'الإثنين' }, { v: 2, en: 'Tuesday', ar: 'الثلاثاء' },
    { v: 3, en: 'Wednesday', ar: 'الأربعاء' }, { v: 4, en: 'Thursday', ar: 'الخميس' }, { v: 5, en: 'Friday', ar: 'الجمعة' }, { v: 6, en: 'Saturday', ar: 'السبت' },
  ];
  const bilingual = (o: { en: string; ar: string }) => tr({ en: o.en, ar: o.ar }, $locale);
  const weekdayLabel = (d: Date) => bilingual(WEEKDAYS[d.getDay()]);

  async function load() {
    loading = true;
    try {
      const p = new URLSearchParams();
      if (f.q.trim()) p.set('q', f.q.trim());
      if (f.year) p.set('year', f.year);
      if (f.month) p.set('month', f.month);
      if (f.dow !== '') p.set('dow', f.dow);
      if (f.serviceTypeId) p.set('serviceTypeId', f.serviceTypeId);
      if (f.from) p.set('from', f.from);
      if (f.to) p.set('to', f.to);
      const qs = p.toString();
      rows = (await api<{ data: any[] }>(`/attendance/events${qs ? `?${qs}` : ''}`)).data;
    } finally { loading = false; }
  }
  function clearFilters() { f = { ...EMPTY }; load(); }
  let searchTimer: ReturnType<typeof setTimeout>;
  function onSearch() { clearTimeout(searchTimer); searchTimer = setTimeout(load, 250); }

  onMount(async () => {
    await load();
    try { ministries = (await api<{ data: any[] }>('/ministries')).data; } catch { /* optional */ }
  });

  // ---- grouping ---------------------------------------------------------------
  const gatheringLabel = (e: any) => tr(e.serviceTypeName ?? {}, $locale) || tr(e.title ?? {}, $locale) || tr({ en: 'Untitled', ar: 'بدون عنوان' }, $locale);
  function keyOf(e: any): { key: string; label: string; sort: number } {
    const d = new Date(e.startsAt);
    if (groupBy === 'weekday') return { key: `w${d.getDay()}`, label: weekdayLabel(d), sort: d.getDay() };
    if (groupBy === 'month') { const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; return { key: k, label: `${bilingual(MONTHS[d.getMonth()])} ${d.getFullYear()}`, sort: -(d.getFullYear() * 100 + d.getMonth()) }; }
    const label = gatheringLabel(e); return { key: `g:${label}`, label, sort: 0 };
  }
  const groups = $derived.by(() => {
    const map = new Map<string, { key: string; label: string; sort: number; events: any[]; total: number; sum: number; latest: number }>();
    for (const e of rows) {
      const { key, label, sort } = keyOf(e);
      let g = map.get(key);
      if (!g) { g = { key, label, sort, events: [], total: 0, sum: 0, latest: 0 }; map.set(key, g); }
      g.events.push(e); g.total += 1; g.sum += e.count ?? 0;
      g.latest = Math.max(g.latest, new Date(e.startsAt).getTime());
    }
    const arr = [...map.values()];
    arr.sort((a, b) => groupBy === 'gathering' ? (b.latest - a.latest) : (a.sort - b.sort));
    return arr;
  });
  const totals = $derived({ sessions: rows.length, attendance: rows.reduce((s, e) => s + (e.count ?? 0), 0) });

  // Collapsible groups. Default: first group open (or all when few).
  let openKeys = $state<Set<string>>(new Set());
  let touched = $state(false);
  $effect(() => {
    if (touched) return;
    const keys = groups.map((g) => g.key);
    openKeys = new Set(keys.length <= 2 ? keys : keys.slice(0, 1));
  });
  function toggle(k: string) { touched = true; const s = new Set(openKeys); s.has(k) ? s.delete(k) : s.add(k); openKeys = s; }
  function expandAll() { touched = true; openKeys = new Set(groups.map((g) => g.key)); }
  function collapseAll() { touched = true; openKeys = new Set(); }

  // Single delete (Super Admin only).
  let confirmOne = $state<any | null>(null);
  let deleting = $state(false);
  async function doDeleteOne() {
    if (!confirmOne) return;
    deleting = true;
    try { await api(`/attendance/events/${confirmOne.id}`, { method: 'DELETE' }); confirmOne = null; await load(); }
    catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); }
    finally { deleting = false; }
  }
</script>

<PageHeader title={$t('nav.attendance')}>
  {#snippet actions()}
    <a href="/analytics" class="btn-ghost border border-slate-300 text-sm dark:border-slate-700">📊 {tr({ en: 'Insights', ar: 'التحليلات' }, $locale)}</a>
    {#if can('create attendance')}<a href="/attendance/new" class="btn-primary">{$t('common.new')}</a>{/if}
  {/snippet}
</PageHeader>
<PageHint id="attendance-list" text={{ en: 'Every gathering (service, meeting or class) grouped so you can find it fast. Categorize by gathering, by weekday (e.g. all Sundays together), or by month — and filter by year, month, day, service or date range. Open any date to record who attended or share its QR.', ar: 'كل الاجتماعات (خدمة أو درس) مجمّعة لتجدها بسرعة. صنّفها حسب الاجتماع أو حسب اليوم (مثلاً كل آحاد معاً) أو حسب الشهر — وصفِّ حسب السنة أو الشهر أو اليوم أو الخدمة أو الفترة. افتح أي تاريخ لتسجيل الحضور أو مشاركة رمز QR.' }} />

<!-- Categorize + summary -->
<div class="mb-4 flex flex-wrap items-center gap-3">
  <div class="inline-flex overflow-hidden rounded-lg border border-slate-300 text-sm dark:border-slate-700">
    {#each [['gathering', { en: 'By gathering', ar: 'حسب الاجتماع' }], ['weekday', { en: 'By weekday', ar: 'حسب اليوم' }], ['month', { en: 'By month', ar: 'حسب الشهر' }]] as [val, lbl], i}
      <button class="px-3 py-1.5 {i > 0 ? 'border-s border-slate-300 dark:border-slate-700' : ''} {groupBy === val ? 'text-white' : 'text-slate-600 dark:text-slate-300'}" style={groupBy === val ? 'background: var(--brand)' : ''} onclick={() => { groupBy = val as any; touched = false; }}>{tr(lbl as any, $locale)}</button>
    {/each}
  </div>
  <span class="text-sm text-slate-500 dark:text-slate-400">{totals.sessions} {tr({ en: 'sessions', ar: 'جلسة' }, $locale)} · {totals.attendance} {tr({ en: 'check-ins', ar: 'تسجيل' }, $locale)}</span>
  {#if groups.length > 1}
    <button class="ms-auto text-xs text-slate-500 hover:underline" onclick={expandAll}>{tr({ en: 'Expand all', ar: 'توسيع الكل' }, $locale)}</button>
    <button class="text-xs text-slate-500 hover:underline" onclick={collapseAll}>{tr({ en: 'Collapse all', ar: 'طي الكل' }, $locale)}</button>
  {/if}
</div>

<FilterBar active={activeCount} onclear={clearFilters}>
  <label class="text-sm">
    <span class="mb-1 block text-xs text-slate-500">{tr({ en: 'Search', ar: 'بحث' }, $locale)}</span>
    <input class="input" bind:value={f.q} oninput={onSearch} placeholder={tr({ en: 'Gathering name…', ar: 'اسم الاجتماع…' }, $locale)} />
  </label>
  <label class="text-sm">
    <span class="mb-1 block text-xs text-slate-500">{tr({ en: 'Day', ar: 'اليوم' }, $locale)}</span>
    <select class="input" bind:value={f.dow} onchange={load}>
      <option value="">{tr({ en: 'Any day', ar: 'كل الأيام' }, $locale)}</option>
      {#each WEEKDAYS as d}<option value={d.v}>{bilingual(d)}</option>{/each}
    </select>
  </label>
  <label class="text-sm">
    <span class="mb-1 block text-xs text-slate-500">{tr({ en: 'Year', ar: 'السنة' }, $locale)}</span>
    <select class="input" bind:value={f.year} onchange={load}>
      <option value="">{tr({ en: 'Any', ar: 'الكل' }, $locale)}</option>
      {#each YEARS as y}<option value={y}>{y}</option>{/each}
    </select>
  </label>
  <label class="text-sm">
    <span class="mb-1 block text-xs text-slate-500">{tr({ en: 'Month', ar: 'الشهر' }, $locale)}</span>
    <select class="input" bind:value={f.month} onchange={load}>
      <option value="">{tr({ en: 'Any', ar: 'الكل' }, $locale)}</option>
      {#each MONTHS as m}<option value={m.v}>{bilingual(m)}</option>{/each}
    </select>
  </label>
  {#if ministries.length}
    <label class="text-sm">
      <span class="mb-1 block text-xs text-slate-500">{tr({ en: 'Service', ar: 'الخدمة' }, $locale)}</span>
      <select class="input" bind:value={f.serviceTypeId} onchange={load}>
        <option value="">{tr({ en: 'Any', ar: 'الكل' }, $locale)}</option>
        {#each ministries as m}<option value={m.id}>{tr(m.name, $locale)}</option>{/each}
      </select>
    </label>
  {/if}
  <label class="text-sm">
    <span class="mb-1 block text-xs text-slate-500">{tr({ en: 'From', ar: 'من' }, $locale)}</span>
    <input class="input force-ltr" type="date" bind:value={f.from} onchange={load} />
  </label>
  <label class="text-sm">
    <span class="mb-1 block text-xs text-slate-500">{tr({ en: 'To', ar: 'إلى' }, $locale)}</span>
    <input class="input force-ltr" type="date" bind:value={f.to} onchange={load} />
  </label>
</FilterBar>

{#if loading}
  <p class="text-slate-400">{$t('common.loading')}</p>
{:else if rows.length === 0}
  <div class="card p-8 text-center text-slate-500">{tr({ en: 'No gatherings match — adjust the filters, or create one with “New”.', ar: 'لا اجتماعات مطابقة — عدّل عوامل التصفية أو أنشئ واحداً بزر «جديد».' }, $locale)}</div>
{:else}
  <div class="space-y-3">
    {#each groups as g (g.key)}
      {@const open = openKeys.has(g.key)}
      <div class="card overflow-hidden">
        <button type="button" class="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-slate-50 dark:hover:bg-slate-800/50" onclick={() => toggle(g.key)}>
          <span class="text-slate-400 transition-transform {open ? 'rotate-90' : ''}">▸</span>
          <span class="font-semibold">{g.label}</span>
          <span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">{g.total} {tr({ en: 'dates', ar: 'تواريخ' }, $locale)}</span>
          <span class="ms-auto flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
            <span>{g.sum} {tr({ en: 'check-ins', ar: 'تسجيل' }, $locale)}</span>
            {#if g.total}<span class="hidden sm:inline">{tr({ en: 'avg', ar: 'متوسط' }, $locale)} {Math.round(g.sum / g.total)}</span>{/if}
          </span>
        </button>
        {#if open}
          <ul class="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">
            {#each g.events as e (e.id)}
              {@const d = new Date(e.startsAt)}
              <li class="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                <a class="min-w-0 flex-1 text-primary-700 hover:underline dark:text-primary-300" href="/attendance/{e.id}">
                  <span class="font-medium">{weekdayLabel(d)}</span>
                  <span class="force-ltr ms-2 text-sm text-slate-500 dark:text-slate-400">{dateTime(e.startsAt)}</span>
                  {#if groupBy !== 'gathering'}<span class="ms-2 text-xs text-slate-400">· {gatheringLabel(e)}</span>{/if}
                </a>
                <span class="shrink-0 rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-medium text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">{e.count ?? 0} {tr({ en: 'in', ar: 'حضور' }, $locale)}</span>
                {#if isSuper}<button class="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:text-slate-400 dark:hover:bg-rose-900/30 dark:hover:text-rose-400" onclick={() => (confirmOne = e)}>{tr({ en: 'Remove', ar: 'إزالة' }, $locale)}</button>{/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<ConfirmDialog
  open={confirmOne !== null}
  danger
  title={tr({ en: 'Delete this attendance record?', ar: 'حذف سجل الحضور هذا؟' }, $locale)}
  message={tr({ en: 'This permanently deletes this attendance record and its check-ins.', ar: 'يحذف سجل الحضور هذا وتسجيلاته نهائياً.' }, $locale)}
  confirmLabel={$t('common.delete')}
  busy={deleting}
  onconfirm={doDeleteOne}
  oncancel={() => (confirmOne = null)}
/>
