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
  }
  interface Meta { page: number; limit: number; total: number; pages: number }

  let rows = $state<Person[]>([]);
  let meta = $state<Meta>({ page: 1, limit: 25, total: 0, pages: 1 });
  let search = $state('');
  let page = $state(1);
  let loading = $state(true);
  let timer: ReturnType<typeof setTimeout>;

  async function load() {
    loading = true;
    try {
      const q = new URLSearchParams({ page: String(page), limit: '25' });
      if (search.trim()) q.set('search', search.trim());
      const r = await api<{ data: Person[]; meta: Meta }>(`/people?${q}`);
      rows = r.data;
      meta = r.meta;
    } finally {
      loading = false;
    }
  }

  function onSearch() {
    clearTimeout(timer);
    timer = setTimeout(() => { page = 1; load(); }, 300);
  }

  onMount(load);
</script>

<div class="mb-6 flex items-center justify-between gap-3">
  <h1 class="text-2xl font-semibold">{$t('nav.members')}</h1>
  {#if can('create person')}
    <a href="/members/new" class="btn-primary">{$t('common.new')}</a>
  {/if}
</div>

<div class="mb-4">
  <input class="input max-w-xs" placeholder={$t('common.search')} bind:value={search} oninput={onSearch} />
</div>

<div class="card overflow-hidden">
  {#if loading}
    <p class="p-6 text-slate-400">{$t('common.loading')}</p>
  {:else if rows.length === 0}
    <p class="p-8 text-center text-slate-500">{$t('members.empty')}</p>
  {:else}
    <table class="w-full text-sm">
      <thead class="border-b border-slate-200 text-start text-slate-500 dark:border-slate-800">
        <tr>
          <th class="p-3 text-start font-medium">{tr({ en: 'Name', ar: 'الاسم' }, $locale)}</th>
          <th class="p-3 text-start font-medium">{tr({ en: 'Status', ar: 'الحالة' }, $locale)}</th>
          <th class="p-3 text-start font-medium">{tr({ en: 'Email', ar: 'البريد' }, $locale)}</th>
          <th class="p-3 text-start font-medium">{tr({ en: 'Mobile', ar: 'الجوال' }, $locale)}</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as p}
          <tr class="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
            <td class="p-3">
              <a class="font-medium text-primary-700 hover:underline dark:text-primary-300" href="/members/{p.id}">
                {tr(p.givenName, $locale)} {tr(p.familyName, $locale)}
              </a>
            </td>
            <td class="p-3 capitalize text-slate-600 dark:text-slate-300">{p.membershipStatus}</td>
            <td class="p-3 force-ltr text-slate-600 dark:text-slate-300">{p.email ?? '—'}</td>
            <td class="p-3 force-ltr text-slate-600 dark:text-slate-300">{p.mobile ?? '—'}</td>
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
