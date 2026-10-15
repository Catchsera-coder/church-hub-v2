<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api.js';
  import { t, locale, tr, enabledLocales } from '$lib/i18n.js';
  import { dateTime } from '$lib/format.js';
  import { can, hasRole } from '$lib/stores/auth.js';
  import DataTable from '$lib/components/DataTable.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import ExportMenu from '$lib/components/ExportMenu.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import { clickOutside } from '$lib/actions/clickOutside.js';

  const id = Number($page.params.id);
  let event = $state<any>(null);
  let records = $state<any[]>([]);
  let loading = $state(true);
  const manage = can('create attendance');
  const canEdit = can('update attendance');
  const canEditPerson = can('update person');
  const isSuper = hasRole('Super Admin');

  // Membership status is the person's REAL status — editing it here writes to the
  // member's record and reflects everywhere. visitor → regular → member → inactive.
  const STATUSES = [
    { v: 'visitor', en: 'Visitor', ar: 'زائر' },
    { v: 'regular', en: 'Regular', ar: 'منتظم' },
    { v: 'member', en: 'Member', ar: 'عضو' },
    { v: 'conference_attendee', en: 'Conference attendee', ar: 'حضور مؤتمر' },
    { v: 'inactive', en: 'Inactive', ar: 'غير نشط' },
  ];
  function statusClasses(s: string): string {
    return s === 'member' ? 'text-emerald-700 dark:text-emerald-300'
      : s === 'inactive' ? 'text-slate-500 dark:text-slate-400'
      : s === 'regular' ? 'text-sky-700 dark:text-sky-300'
      : s === 'conference_attendee' ? 'text-violet-700 dark:text-violet-300'
      : 'text-amber-700 dark:text-amber-300';
  }
  let savingStatus = $state<number | null>(null);
  let statusSaved = $state<number | null>(null);
  async function setStatus(r: any, value: string) {
    if (!r.personId || value === r.membershipStatus) return;
    const prev = r.membershipStatus;
    savingStatus = r.personId;
    r.membershipStatus = value; records = records; // optimistic
    try {
      await api(`/people/${r.personId}`, { method: 'PUT', body: JSON.stringify({ membershipStatus: value }) });
      statusSaved = r.personId; setTimeout(() => { if (statusSaved === r.personId) statusSaved = null; }, 1500);
    } catch (err) {
      r.membershipStatus = prev; records = records;
      alert(err instanceof ApiError ? err.message : (err as Error).message);
    } finally { savingStatus = null; }
  }

  // 'all' | 'new' (visitor/self-registered) | 'member' (regular/member).
  // Attendee-list filters (all client-side over the loaded records; the Export
  // menu sends the same filters to the server so the file matches the view).
  let fq = $state('');
  let fStatuses = $state<Set<string>>(new Set());
  let fAges = $state<Set<string>>(new Set());
  let fNewOnly = $state(false);
  let showFilters = $state(false);
  const AGES = [{ v: 'child', en: 'Children', ar: 'أطفال' }, { v: 'youth', en: 'Youth', ar: 'شباب' }, { v: 'adult', en: 'Adults', ar: 'بالغون' }];
  function toggleFilter(which: 'statuses' | 'ages', v: string) {
    const cur = which === 'statuses' ? fStatuses : fAges;
    const n = new Set(cur); if (n.has(v)) n.delete(v); else n.add(v);
    if (which === 'statuses') fStatuses = n; else fAges = n;
  }
  const ageGroupOf = (dob: string | null): 'child' | 'youth' | 'adult' | null => {
    if (!dob) return null;
    const y = (Date.now() - new Date(dob).getTime()) / (365.25 * 864e5);
    return y < 13 ? 'child' : y < 18 ? 'youth' : 'adult';
  };
  const filtered = $derived(records.filter((r) => {
    if (fq.trim()) { const q = fq.trim().toLowerCase(); const name = `${tr(r.givenName, $locale)} ${tr(r.familyName, $locale)}`.toLowerCase(); if (!name.includes(q)) return false; }
    if (fStatuses.size && !fStatuses.has(r.membershipStatus)) return false;
    if (fAges.size) { const g = ageGroupOf(r.dateOfBirth); if (!g || !fAges.has(g)) return false; }
    if (fNewOnly && !(r.selfRegistered && !r.reviewedAt)) return false;
    return true;
  }));
  const fCount = $derived((fq.trim() ? 1 : 0) + fStatuses.size + fAges.size + (fNewOnly ? 1 : 0));
  function clearFilters() { fq = ''; fStatuses = new Set(); fAges = new Set(); fNewOnly = false; }
  const attExportParams = $derived.by(() => {
    const p = new URLSearchParams(); p.set('eventId', String(id));
    if (fq.trim()) p.set('q', fq.trim());
    if (fStatuses.size) p.set('statuses', [...fStatuses].join(','));
    if (fAges.size) p.set('ageGroups', [...fAges].join(','));
    if (fNewOnly) p.set('newOnly', 'true');
    return p.toString();
  });

  // Rename + reschedule
  let editing = $state(false);
  let title = $state<Record<string, string>>({});
  let startsAt = $state('');
  let savingTitle = $state(false);
  const toLocalInput = (iso: string) => {
    const d = new Date(iso); const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  // Delete
  let confirmDelete = $state(false);
  let deleting = $state(false);

  // Person typeahead for manual check-in
  let personQuery = $state('');
  let personResults = $state<any[]>([]);
  let adding = $state(false);
  let searchTimer: ReturnType<typeof setTimeout>;

  async function load() {
    loading = true;
    try {
      const [ev, recs] = await Promise.all([
        api<{ data: any }>(`/attendance/events/${id}`),
        api<{ data: any[] }>(`/attendance/events/${id}/records`),
      ]);
      event = ev.data;
      title = { ...(ev.data.title ?? {}) };
      startsAt = toLocalInput(ev.data.startsAt);
      records = recs.data;
    } finally { loading = false; }
  }
  onMount(load);

  async function saveTitle() {
    savingTitle = true;
    try {
      const body: Record<string, unknown> = { title };
      if (startsAt) body.startsAt = new Date(startsAt).toISOString();
      const { data } = await api<{ data: any }>(`/attendance/events/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      event = data;
      editing = false;
    } catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); }
    finally { savingTitle = false; }
  }

  async function doDelete() {
    deleting = true;
    try {
      await api(`/attendance/events/${id}`, { method: 'DELETE' });
      await goto('/attendance');
    } catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); deleting = false; }
  }

  function searchPeople() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      if (!personQuery.trim()) { personResults = []; return; }
      const q = new URLSearchParams({ search: personQuery.trim(), limit: '8' });
      personResults = (await api<{ data: any[] }>(`/people?${q}`)).data;
    }, 250);
  }

  async function checkIn(p: any) {
    adding = true;
    try {
      await api(`/attendance/events/${id}/records`, { method: 'POST', body: JSON.stringify({ personId: p.id }) });
      personQuery = ''; personResults = [];
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : (err as Error).message);
    } finally { adding = false; }
  }

  // --- Family check-in: pick a name → show their whole family with checkboxes,
  // check in all or a selected few at once. Already checked-in members are shown
  // as done. Works for a single person too (no household).
  const checkedInIds = $derived(new Set(records.map((r) => r.personId)));
  let checkinAnchor = $state<any | null>(null);
  let familyMembers = $state<any[]>([]);
  let familySel = $state<Set<number>>(new Set());
  let loadingFamily = $state(false);
  let checkingIn = $state(false);
  const personName = (p: any) => `${tr(p.givenName, $locale)} ${tr(p.familyName, $locale)}`.trim();

  async function pickForCheckin(p: any) {
    personResults = []; personQuery = '';
    checkinAnchor = p; familyMembers = []; familySel = new Set();
    loadingFamily = true;
    try {
      const full = (await api<{ data: any }>(`/people/${p.id}`)).data;
      let fam = [full];
      if (full?.householdId) {
        const r = await api<{ data: any[] }>(`/families/${full.householdId}/members`);
        if (r.data?.length) fam = r.data;
      }
      familyMembers = fam;
      familySel = new Set(checkedInIds.has(p.id) ? [] : [p.id]); // pre-check the searched person if not already in
    } catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); checkinAnchor = null; }
    finally { loadingFamily = false; }
  }
  function toggleFam(id: number) { const s = new Set(familySel); s.has(id) ? s.delete(id) : s.add(id); familySel = s; }
  function selectAllFam() { familySel = new Set(familyMembers.filter((m) => !checkedInIds.has(m.id)).map((m) => m.id)); }
  function cancelCheckin() { checkinAnchor = null; familyMembers = []; familySel = new Set(); }
  async function checkInSelected() {
    const ids = [...familySel].filter((pid) => !checkedInIds.has(pid));
    if (!ids.length) { cancelCheckin(); return; }
    checkingIn = true;
    try {
      for (const pid of ids) await api(`/attendance/events/${id}/records`, { method: 'POST', body: JSON.stringify({ personId: pid }) });
      cancelCheckin();
      await load();
    } catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); }
    finally { checkingIn = false; }
  }
</script>

<PageHeader title={event ? tr(event.title, $locale) || tr({ en: 'Attendance', ar: 'الحضور' }, $locale) : tr({ en: 'Attendance', ar: 'الحضور' }, $locale)} back="/attendance">
  {#snippet actions()}
    {#if event}<ExportMenu resource="attendance-event" title={tr(event.title, $locale) || tr({ en: 'Attendance', ar: 'الحضور' }, $locale)} params={attExportParams} />{/if}
    {#if canEdit}<button class="btn-ghost" onclick={() => (editing = !editing)}>{tr({ en: 'Edit name / time', ar: 'تعديل الوقت / الاسم' }, $locale)}</button>{/if}
    {#if isSuper}<button class="btn-ghost text-rose-600 dark:text-rose-400" onclick={() => (confirmDelete = true)}>{$t('common.delete')}</button>{/if}
  {/snippet}
</PageHeader>

{#if event}
  <p class="mb-4 -mt-2 text-sm text-slate-500 force-ltr">{dateTime(event.startsAt)}</p>
{/if}

{#if editing}
  <div class="card mb-4 max-w-md space-y-3 p-4">
    {#each $enabledLocales as l}
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Name', ar: 'الاسم' }, $locale)} ({l.native})</span>
        <input class="input" dir={l.dir} bind:value={title[l.code]} />
      </label>
    {/each}
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Date & time', ar: 'التاريخ والوقت' }, $locale)}</span>
      <input class="input force-ltr" type="datetime-local" bind:value={startsAt} />
    </label>
    <div class="flex gap-2">
      <button class="btn-primary" onclick={saveTitle} disabled={savingTitle}>{savingTitle ? $t('common.loading') : $t('common.save')}</button>
      <button class="btn-ghost" onclick={() => { editing = false; title = { ...(event.title ?? {}) }; }}>{tr({ en: 'Cancel', ar: 'إلغاء' }, $locale)}</button>
    </div>
  </div>
{/if}

{#if manage}
  <div class="mb-4 rounded-2xl border-2 border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900/50 dark:bg-emerald-900/10">
    <p class="mb-1 flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-200">
      <span class="grid h-6 w-6 place-items-center rounded-full bg-emerald-600 text-white">✓</span>
      {tr({ en: 'Check someone in', ar: 'سجّل حضور شخص' }, $locale)}
    </p>
    <p class="mb-2 text-xs text-emerald-700/80 dark:text-emerald-300/70">{tr({ en: 'Search a name to add them (and their family) to this gathering. To narrow the list below instead, use Filter.', ar: 'ابحث عن اسم لإضافته (وعائلته) لهذا اللقاء. لتصفية القائمة بالأسفل استخدم «تصفية».' }, $locale)}</p>
    <div class="relative max-w-md" use:clickOutside={() => (personResults = [])}>
      <input class="input border-emerald-300 bg-white focus:border-emerald-500 dark:border-emerald-800 dark:bg-slate-900" bind:value={personQuery} oninput={searchPeople} disabled={adding || checkingIn}
        placeholder={tr({ en: '＋ Search a name to check in…', ar: '＋ ابحث عن اسم لتسجيل حضوره…' }, $locale)} />
      {#if personResults.length}
        <div class="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {#each personResults as p}
            <button type="button" class="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-slate-100 dark:hover:bg-slate-800" onclick={() => pickForCheckin(p)}>
              <span>{tr(p.givenName, $locale)} {tr(p.familyName, $locale)}</span>
              {#if checkedInIds.has(p.id)}<span class="text-xs text-emerald-600 dark:text-emerald-400">✓ {tr({ en: 'in', ar: 'حاضر' }, $locale)}</span>{:else}<span class="text-xs" style="color: var(--brand)">{tr({ en: 'check in →', ar: 'تسجيل →' }, $locale)}</span>{/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Family check-in panel: whole household with checkboxes -->
    {#if checkinAnchor}
      <div class="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
        {#if loadingFamily}
          <p class="text-sm text-slate-400">{$t('common.loading')}</p>
        {:else}
          <div class="mb-2 flex flex-wrap items-center gap-2">
            <span class="text-sm font-medium">{tr({ en: 'Check in family', ar: 'تسجيل حضور العائلة' }, $locale)}{#if familyMembers.length > 1} <span class="text-slate-400">({familyMembers.length})</span>{/if}</span>
            {#if familyMembers.length > 1}
              <button type="button" class="text-xs hover:underline" style="color: var(--brand)" onclick={selectAllFam}>{tr({ en: 'Select all', ar: 'تحديد الكل' }, $locale)}</button>
              <button type="button" class="text-xs text-slate-500 hover:underline" onclick={() => (familySel = new Set())}>{tr({ en: 'Clear', ar: 'مسح' }, $locale)}</button>
            {/if}
            <button type="button" class="ms-auto text-xs text-slate-500 hover:underline" onclick={cancelCheckin}>{$t('common.cancel')}</button>
          </div>
          <ul class="space-y-1">
            {#each familyMembers as m (m.id)}
              {@const done = checkedInIds.has(m.id)}
              <li class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm {done ? 'opacity-70' : 'hover:bg-white dark:hover:bg-slate-800'}">
                <input type="checkbox" checked={done || familySel.has(m.id)} disabled={done} onchange={() => toggleFam(m.id)} />
                <span class="flex-1">{personName(m)}{#if m.householdRole} <span class="text-xs text-slate-400 capitalize">· {(m.householdRole || '').replace(/_/g, ' ')}</span>{/if}</span>
                {#if done}<span class="text-xs text-emerald-600 dark:text-emerald-400">✓ {tr({ en: 'checked in', ar: 'مسجّل' }, $locale)}</span>{/if}
              </li>
            {/each}
          </ul>
          <div class="mt-3">
            <button class="btn-primary" disabled={checkingIn || [...familySel].filter((x) => !checkedInIds.has(x)).length === 0} onclick={checkInSelected}>
              {checkingIn ? $t('common.loading') : tr({ en: `Check in ${[...familySel].filter((x) => !checkedInIds.has(x)).length}`, ar: `تسجيل ${[...familySel].filter((x) => !checkedInIds.has(x)).length}` }, $locale)}
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<!-- Attendee list: clear header + its own filters (separate from check-in above) -->
<div class="mb-3 mt-6 flex flex-wrap items-center gap-2">
  <h2 class="text-lg font-semibold">{tr({ en: 'Attendees', ar: 'الحاضرون' }, $locale)}</h2>
  <span class="rounded-full bg-slate-100 px-2.5 py-0.5 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">{filtered.length}{#if fCount} / {records.length}{/if}</span>
  <button class="btn-ghost ms-auto border border-slate-300 text-sm dark:border-slate-700 {fCount ? 'text-white' : ''}" style={fCount ? 'background: var(--brand); border-color: transparent' : ''} onclick={() => (showFilters = !showFilters)}>
    ⚙ {tr({ en: 'Filter', ar: 'تصفية' }, $locale)}{#if fCount} · {fCount}{/if}
  </button>
</div>

{#if showFilters}
  <div class="mb-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/40">
    <div class="flex flex-wrap items-center gap-2">
      <input class="input max-w-xs" bind:value={fq} placeholder={tr({ en: 'Search a name in the list…', ar: 'ابحث عن اسم في القائمة…' }, $locale)} />
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={fNewOnly} /> {tr({ en: 'New / first-time only', ar: 'الجدد فقط' }, $locale)}</label>
      {#if fCount}<button class="ms-auto text-xs text-slate-500 hover:underline" onclick={clearFilters}>{tr({ en: 'Clear filters', ar: 'مسح التصفية' }, $locale)}</button>{/if}
    </div>
    <div>
      <span class="mb-1.5 block text-xs font-medium text-slate-500">{tr({ en: 'Status', ar: 'الحالة' }, $locale)}</span>
      <div class="flex flex-wrap gap-1.5">
        {#each STATUSES as s (s.v)}
          <button type="button" class="rounded-full border px-3 py-1 text-xs {fStatuses.has(s.v) ? 'border-transparent text-white' : 'border-slate-300 dark:border-slate-700'}" style={fStatuses.has(s.v) ? 'background: var(--brand)' : ''} onclick={() => toggleFilter('statuses', s.v)}>{tr({ en: s.en, ar: s.ar }, $locale)}</button>
        {/each}
      </div>
    </div>
    <div>
      <span class="mb-1.5 block text-xs font-medium text-slate-500">{tr({ en: 'Age group', ar: 'الفئة العمرية' }, $locale)}</span>
      <div class="flex flex-wrap gap-1.5">
        {#each AGES as a (a.v)}
          <button type="button" class="rounded-full border px-3 py-1 text-xs {fAges.has(a.v) ? 'border-transparent text-white' : 'border-slate-300 dark:border-slate-700'}" style={fAges.has(a.v) ? 'background: var(--brand)' : ''} onclick={() => toggleFilter('ages', a.v)}>{tr({ en: a.en, ar: a.ar }, $locale)}</button>
        {/each}
      </div>
    </div>
    <p class="text-xs text-slate-400">{tr({ en: 'The Export button downloads exactly this filtered list.', ar: 'زر «تصدير» ينزّل هذه القائمة المُصفّاة تماماً.' }, $locale)}</p>
  </div>
{/if}

{#if canEditPerson && records.length}
  <p class="mb-3 flex items-center gap-1.5 text-xs text-slate-400">
    <span>✏️</span>
    <span>{tr({ en: 'Tip: change anyone’s status right here — it updates their member record everywhere (e.g. move a first-time visitor to Regular or Member).', ar: 'نصيحة: غيّر حالة أي شخص من هنا — تُحدَّث في سجل العضو في كل مكان (مثلاً نقل زائر لأول مرة إلى منتظم أو عضو).' }, $locale)}</span>
  </p>
{/if}

<DataTable {loading} rows={filtered} headers={[tr({ en: 'Name', ar: 'الاسم' }, $locale), tr({ en: 'Status', ar: 'الحالة' }, $locale), tr({ en: 'Checked in', ar: 'وقت التسجيل' }, $locale)]}>
  {#snippet row(r)}
    <td class="p-3 font-medium">
      {#if r.personId && can('view person')}
        <a class="text-primary-700 hover:underline dark:text-primary-300" href="/members/{r.personId}?back={encodeURIComponent(`/attendance/${id}`)}">{tr(r.givenName, $locale)} {tr(r.familyName, $locale)}</a>
      {:else}
        {tr(r.givenName, $locale)} {tr(r.familyName, $locale)}
      {/if}
      {#if r.selfRegistered && !r.reviewedAt}<span class="ms-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{tr({ en: 'new', ar: 'جديد' }, $locale)}</span>{/if}
    </td>
    <td class="p-3">
      {#if canEditPerson && r.personId}
        <span class="inline-flex items-center gap-1.5">
          <select class="input h-8 w-32 py-0 text-xs font-medium capitalize {statusClasses(r.membershipStatus)}" value={r.membershipStatus} disabled={savingStatus === r.personId} onchange={(e) => setStatus(r, (e.currentTarget as HTMLSelectElement).value)}>
            {#each STATUSES as s}<option value={s.v}>{tr({ en: s.en, ar: s.ar }, $locale)}</option>{/each}
          </select>
          {#if savingStatus === r.personId}<span class="text-xs text-slate-400">…</span>{:else if statusSaved === r.personId}<span class="text-xs text-emerald-600 dark:text-emerald-400">✓</span>{/if}
        </span>
      {:else}
        <span class="capitalize font-medium {statusClasses(r.membershipStatus)}">{r.membershipStatus}</span>
      {/if}
    </td>
    <td class="p-3 force-ltr text-slate-600 dark:text-slate-300">{dateTime(r.checkedInAt)}</td>
  {/snippet}
</DataTable>

<ConfirmDialog
  bind:open={confirmDelete}
  danger
  title={tr({ en: 'Delete this attendance record?', ar: 'حذف سجل الحضور هذا؟' }, $locale)}
  message={tr({ en: 'This permanently deletes this attendance record AND all of its check-ins. This cannot be undone. Type its name to confirm.', ar: 'سيؤدي هذا إلى حذف سجل الحضور وكل تسجيلاته نهائياً. لا يمكن التراجع. اكتب اسمه للتأكيد.' }, $locale)}
  requireText={event ? tr(event.title, $locale) : ''}
  confirmLabel={$t('common.delete')}
  busy={deleting}
  onconfirm={doDelete}
/>
