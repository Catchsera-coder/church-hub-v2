<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { t, locale, tr, displayName } from '$lib/i18n.js';
  import { nameOrder } from '$lib/stores/prefs.js';
  import { can } from '$lib/stores/auth.js';
  import FilterBar from '$lib/components/FilterBar.svelte';

  interface Person {
    id: number;
    givenName: Record<string, string>;
    familyName: Record<string, string>;
    membershipStatus: string;
    email: string | null;
    mobile: string | null;
    selfRegistered?: boolean;
    reviewedAt?: string | null;
    householdRole?: string | null;
  }
  interface Meta { page: number; limit: number; total: number; pages: number }

  const MONTHS = [
    { v: 1, en: 'January', ar: 'يناير' }, { v: 2, en: 'February', ar: 'فبراير' },
    { v: 3, en: 'March', ar: 'مارس' }, { v: 4, en: 'April', ar: 'أبريل' },
    { v: 5, en: 'May', ar: 'مايو' }, { v: 6, en: 'June', ar: 'يونيو' },
    { v: 7, en: 'July', ar: 'يوليو' }, { v: 8, en: 'August', ar: 'أغسطس' },
    { v: 9, en: 'September', ar: 'سبتمبر' }, { v: 10, en: 'October', ar: 'أكتوبر' },
    { v: 11, en: 'November', ar: 'نوفمبر' }, { v: 12, en: 'December', ar: 'ديسمبر' },
  ];

  // Empty string = filter off. Kept in one object so "active count" + clear are simple.
  const EMPTY = {
    status: '', ageGroup: '', birthdayMonth: '', anniversaryMonth: '',
    ministryId: '', optedIn: '', hasPhone: '', inactiveWeeks: '', missingContact: '',
  };
  let f = $state({ ...EMPTY });
  const activeCount = $derived(Object.values(f).filter((v) => v !== '').length);

  let rows = $state<Person[]>([]);
  let meta = $state<Meta>({ page: 1, limit: 25, total: 0, pages: 1 });
  let search = $state('');
  let page = $state(1);
  let loading = $state(true);
  let reviewOnly = $state(false);
  let pendingCount = $state(0);
  let ministries = $state<{ id: number; name: Record<string, string> }[]>([]);
  let timer: ReturnType<typeof setTimeout>;

  async function load() {
    loading = true;
    try {
      const q = new URLSearchParams({ page: String(page), limit: '25' });
      if (search.trim()) q.set('search', search.trim());
      if (reviewOnly) q.set('review', 'pending');
      for (const [k, v] of Object.entries(f)) if (v !== '') q.set(k, String(v));
      const r = await api<{ data: Person[]; meta: Meta }>(`/people?${q}`);
      rows = r.data;
      meta = r.meta;
    } finally {
      loading = false;
    }
  }

  async function loadPendingCount() {
    try { pendingCount = (await api<{ meta: Meta }>(`/people?review=pending&limit=1`)).meta.total; }
    catch { pendingCount = 0; }
  }

  function onSearch() { clearTimeout(timer); timer = setTimeout(() => { page = 1; load(); }, 300); }
  function applyFilters() { page = 1; load(); }
  function clearFilters() { f = { ...EMPTY }; page = 1; load(); }
  function toggleReview() { reviewOnly = !reviewOnly; page = 1; load(); }

  async function markReviewed(p: Person) {
    await api(`/people/${p.id}/review`, { method: 'POST', body: JSON.stringify({}) });
    await Promise.all([load(), loadPendingCount()]);
  }

  onMount(async () => {
    load();
    loadPendingCount();
    try { ministries = (await api<{ data: any[] }>('/ministries')).data; } catch { /* optional */ }
  });
</script>

<div class="mb-6 flex items-center justify-between gap-3">
  <h1 class="text-2xl font-semibold">{$t('nav.members')}</h1>
  {#if can('create person')}
    <a href="/members/new" class="btn-primary">{$t('common.new')}</a>
  {/if}
</div>

{#if pendingCount > 0 && !reviewOnly}
  <button class="mb-4 flex w-full items-center gap-3 rounded-xl bg-amber-50 px-4 py-3 text-start text-sm text-amber-800 hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-200 dark:hover:bg-amber-900/30" onclick={toggleReview}>
    <span class="text-lg">🔔</span>
    <span class="flex-1">
      {pendingCount}
      {pendingCount === 1
        ? tr({ en: 'person self-registered and needs review.', ar: 'شخص سجّل نفسه ويحتاج للمراجعة.' }, $locale)
        : tr({ en: 'people self-registered and need review.', ar: 'أشخاص سجّلوا أنفسهم ويحتاجون للمراجعة.' }, $locale)}
    </span>
    <span class="font-medium underline">{tr({ en: 'Review', ar: 'مراجعة' }, $locale)} ›</span>
  </button>
{/if}

<div class="mb-3 flex flex-wrap items-center gap-3">
  <input class="input max-w-xs" placeholder={$t('common.search')} bind:value={search} oninput={onSearch} />
  <button class="btn-ghost text-sm {reviewOnly ? 'text-amber-700 ring-1 ring-amber-400 dark:text-amber-300' : ''}" onclick={toggleReview}>
    {reviewOnly ? tr({ en: '✓ Needs review', ar: '✓ يحتاج مراجعة' }, $locale) : tr({ en: 'Needs review', ar: 'يحتاج مراجعة' }, $locale)}
  </button>
  <div class="ms-auto flex items-center gap-2 text-sm text-slate-500">
    <span>{tr({ en: 'Name', ar: 'الاسم' }, $locale)}:</span>
    <select class="input w-auto py-1 text-sm" bind:value={$nameOrder}>
      <option value="given-first">{tr({ en: 'First Last', ar: 'الأول الأخير' }, $locale)}</option>
      <option value="family-first">{tr({ en: 'Last First', ar: 'الأخير الأول' }, $locale)}</option>
    </select>
  </div>
</div>

<FilterBar active={activeCount} onclear={clearFilters}>
  <label class="text-sm">
    <span class="mb-1 block text-slate-500">{tr({ en: 'Status', ar: 'الحالة' }, $locale)}</span>
    <select class="input w-40" bind:value={f.status} onchange={applyFilters}>
      <option value="">{tr({ en: 'Any', ar: 'الكل' }, $locale)}</option>
      <option value="visitor">{tr({ en: 'Visitor', ar: 'زائر' }, $locale)}</option>
      <option value="regular">{tr({ en: 'Regular', ar: 'منتظم' }, $locale)}</option>
      <option value="member">{tr({ en: 'Member', ar: 'عضو' }, $locale)}</option>
      <option value="inactive">{tr({ en: 'Inactive', ar: 'غير نشط' }, $locale)}</option>
    </select>
  </label>
  <label class="text-sm">
    <span class="mb-1 block text-slate-500">{tr({ en: 'Age group', ar: 'الفئة العمرية' }, $locale)}</span>
    <select class="input w-36" bind:value={f.ageGroup} onchange={applyFilters}>
      <option value="">{tr({ en: 'Any', ar: 'الكل' }, $locale)}</option>
      <option value="child">{tr({ en: 'Children (<13)', ar: 'أطفال (<13)' }, $locale)}</option>
      <option value="youth">{tr({ en: 'Youth (13–17)', ar: 'شباب (13–17)' }, $locale)}</option>
      <option value="adult">{tr({ en: 'Adults (18+)', ar: 'بالغون (18+)' }, $locale)}</option>
    </select>
  </label>
  <label class="text-sm">
    <span class="mb-1 block text-slate-500">🎂 {tr({ en: 'Birthday month', ar: 'شهر الميلاد' }, $locale)}</span>
    <select class="input w-36" bind:value={f.birthdayMonth} onchange={applyFilters}>
      <option value="">{tr({ en: 'Any', ar: 'الكل' }, $locale)}</option>
      {#each MONTHS as m}<option value={m.v}>{tr({ en: m.en, ar: m.ar }, $locale)}</option>{/each}
    </select>
  </label>
  <label class="text-sm">
    <span class="mb-1 block text-slate-500">🎉 {tr({ en: 'Joined month', ar: 'شهر الانضمام' }, $locale)}</span>
    <select class="input w-36" bind:value={f.anniversaryMonth} onchange={applyFilters}>
      <option value="">{tr({ en: 'Any', ar: 'الكل' }, $locale)}</option>
      {#each MONTHS as m}<option value={m.v}>{tr({ en: m.en, ar: m.ar }, $locale)}</option>{/each}
    </select>
  </label>
  <label class="text-sm">
    <span class="mb-1 block text-slate-500">{tr({ en: 'Ministry', ar: 'الخدمة' }, $locale)}</span>
    <select class="input w-40" bind:value={f.ministryId} onchange={applyFilters}>
      <option value="">{tr({ en: 'Any', ar: 'الكل' }, $locale)}</option>
      {#each ministries as m}<option value={m.id}>{tr(m.name, $locale)}</option>{/each}
    </select>
  </label>
  <label class="text-sm">
    <span class="mb-1 block text-slate-500">{tr({ en: 'Opted in to', ar: 'موافق على' }, $locale)}</span>
    <select class="input w-36" bind:value={f.optedIn} onchange={applyFilters}>
      <option value="">{tr({ en: 'Any', ar: 'الكل' }, $locale)}</option>
      <option value="email">{tr({ en: 'Email', ar: 'البريد' }, $locale)}</option>
      <option value="sms">{tr({ en: 'SMS', ar: 'SMS' }, $locale)}</option>
      <option value="whatsapp">{tr({ en: 'WhatsApp', ar: 'واتساب' }, $locale)}</option>
    </select>
  </label>
  <label class="text-sm">
    <span class="mb-1 block text-slate-500">{tr({ en: 'Not seen in', ar: 'لم يحضر منذ' }, $locale)}</span>
    <select class="input w-40" bind:value={f.inactiveWeeks} onchange={applyFilters}>
      <option value="">{tr({ en: 'Any', ar: 'الكل' }, $locale)}</option>
      <option value="4">{tr({ en: '4+ weeks', ar: '4+ أسابيع' }, $locale)}</option>
      <option value="8">{tr({ en: '8+ weeks', ar: '8+ أسابيع' }, $locale)}</option>
      <option value="12">{tr({ en: '12+ weeks', ar: '12+ أسبوع' }, $locale)}</option>
    </select>
  </label>
  <label class="flex items-center gap-2 pb-2 text-sm text-slate-600 dark:text-slate-300">
    <input type="checkbox" checked={f.hasPhone === 'true'} onchange={(e) => { f.hasPhone = (e.currentTarget as HTMLInputElement).checked ? 'true' : ''; applyFilters(); }} />
    {tr({ en: 'Has phone', ar: 'لديه هاتف' }, $locale)}
  </label>
  <label class="flex items-center gap-2 pb-2 text-sm text-slate-600 dark:text-slate-300">
    <input type="checkbox" checked={f.missingContact === 'true'} onchange={(e) => { f.missingContact = (e.currentTarget as HTMLInputElement).checked ? 'true' : ''; applyFilters(); }} />
    {tr({ en: 'Missing contact', ar: 'بدون بيانات تواصل' }, $locale)}
  </label>
</FilterBar>

<div class="card overflow-hidden">
  {#if loading}
    <p class="p-6 text-slate-400">{$t('common.loading')}</p>
  {:else if rows.length === 0}
    <p class="p-8 text-center text-slate-500">{reviewOnly ? tr({ en: 'Nothing to review — all caught up! 🎉', ar: 'لا شيء للمراجعة — كل شيء محدّث! 🎉' }, $locale) : $t('members.empty')}</p>
  {:else}
    <table class="w-full text-sm">
      <thead class="border-b border-slate-200 text-start text-slate-500 dark:border-slate-800">
        <tr>
          <th class="p-3 text-start font-medium">{tr({ en: 'Name', ar: 'الاسم' }, $locale)}</th>
          <th class="p-3 text-start font-medium">{tr({ en: 'Status', ar: 'الحالة' }, $locale)}</th>
          <th class="p-3 text-start font-medium">{tr({ en: 'Email', ar: 'البريد' }, $locale)}</th>
          <th class="p-3 text-start font-medium">{tr({ en: 'Mobile', ar: 'الجوال' }, $locale)}</th>
          {#if reviewOnly}<th class="p-3 text-start font-medium">{tr({ en: 'Action', ar: 'إجراء' }, $locale)}</th>{/if}
        </tr>
      </thead>
      <tbody>
        {#each rows as p}
          <tr class="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
            <td class="p-3">
              <a class="font-medium text-primary-700 hover:underline dark:text-primary-300" href="/members/{p.id}">
                {displayName(p, $nameOrder, $locale)}
              </a>
              {#if p.selfRegistered && !p.reviewedAt}
                <span class="ms-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{tr({ en: 'new', ar: 'جديد' }, $locale)}</span>
              {/if}
              {#if p.householdRole}<span class="ms-1 text-xs text-slate-400">· {p.householdRole}</span>{/if}
            </td>
            <td class="p-3 capitalize text-slate-600 dark:text-slate-300">{p.membershipStatus}</td>
            <td class="p-3 force-ltr text-slate-600 dark:text-slate-300">{p.email ?? '—'}</td>
            <td class="p-3 force-ltr text-slate-600 dark:text-slate-300">{p.mobile ?? '—'}</td>
            {#if reviewOnly}
              <td class="p-3">
                {#if can('update person')}
                  <button class="btn-ghost text-xs text-emerald-700 dark:text-emerald-300" onclick={() => markReviewed(p)}>{tr({ en: 'Mark reviewed', ar: 'تم المراجعة' }, $locale)}</button>
                {/if}
              </td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

{#if meta.pages > 1}
  <div class="mt-4 flex items-center justify-between text-sm">
    <span class="text-slate-500">{meta.total} · {meta.page}/{meta.pages}</span>
    <div class="flex gap-2">
      <button class="btn-ghost" disabled={page <= 1} onclick={() => { page--; load(); }}>‹</button>
      <button class="btn-ghost" disabled={page >= meta.pages} onclick={() => { page++; load(); }}>›</button>
    </div>
  </div>
{/if}
