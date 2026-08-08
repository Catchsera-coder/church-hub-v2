<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import { can } from '$lib/stores/auth.js';

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

  let rows = $state<Person[]>([]);
  let meta = $state<Meta>({ page: 1, limit: 25, total: 0, pages: 1 });
  let search = $state('');
  let page = $state(1);
  let loading = $state(true);
  let reviewOnly = $state(false); // show only self-registered people awaiting review
  let pendingCount = $state(0);
  let timer: ReturnType<typeof setTimeout>;

  async function load() {
    loading = true;
    try {
      const q = new URLSearchParams({ page: String(page), limit: '25' });
      if (search.trim()) q.set('search', search.trim());
      if (reviewOnly) q.set('review', 'pending');
      const r = await api<{ data: Person[]; meta: Meta }>(`/people?${q}`);
      rows = r.data;
      meta = r.meta;
    } finally {
      loading = false;
    }
  }

  // Count of people who self-registered and haven't been vetted yet (for the badge).
  async function loadPendingCount() {
    try {
      const r = await api<{ meta: Meta }>(`/people?review=pending&limit=1`);
      pendingCount = r.meta.total;
    } catch { pendingCount = 0; }
  }

  function onSearch() {
    clearTimeout(timer);
    timer = setTimeout(() => { page = 1; load(); }, 300);
  }

  function toggleReview() {
    reviewOnly = !reviewOnly;
    page = 1;
    load();
  }

  async function markReviewed(p: Person) {
    await api(`/people/${p.id}/review`, { method: 'POST', body: JSON.stringify({}) });
    await Promise.all([load(), loadPendingCount()]);
  }

  onMount(() => { load(); loadPendingCount(); });
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

<div class="mb-4 flex items-center gap-3">
  <input class="input max-w-xs" placeholder={$t('common.search')} bind:value={search} oninput={onSearch} />
  <button class="btn-ghost text-sm {reviewOnly ? 'ring-1 ring-amber-400 text-amber-700 dark:text-amber-300' : ''}" onclick={toggleReview}>
    {reviewOnly ? tr({ en: '✓ Needs review', ar: '✓ يحتاج مراجعة' }, $locale) : tr({ en: 'Needs review', ar: 'يحتاج مراجعة' }, $locale)}
  </button>
</div>

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
                {tr(p.givenName, $locale)} {tr(p.familyName, $locale)}
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
