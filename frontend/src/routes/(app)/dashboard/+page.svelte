<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { t } from '$lib/i18n.js';

  interface Stats { members: number; households: number; attendanceThisMonth: number; givingThisMonthCents?: number }
  let stats = $state<Stats | null>(null);
  let loading = $state(true);

  onMount(async () => {
    try {
      const r = await api<{ data: Stats }>('/dashboard/stats');
      stats = r.data;
    } finally {
      loading = false;
    }
  });

  const money = (cents: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(cents / 100);
</script>

<h1 class="mb-6 text-2xl font-semibold">{$t('nav.dashboard')}</h1>

{#if loading}
  <p class="text-slate-400">{$t('common.loading')}</p>
{:else if stats}
  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
    <div class="card p-5">
      <p class="text-sm text-slate-500">{$t('stat.members')}</p>
      <p class="mt-1 text-3xl font-semibold">{stats.members}</p>
    </div>
    <div class="card p-5">
      <p class="text-sm text-slate-500">{$t('stat.families')}</p>
      <p class="mt-1 text-3xl font-semibold">{stats.households}</p>
    </div>
    <div class="card p-5">
      <p class="text-sm text-slate-500">{$t('stat.attendance')}</p>
      <p class="mt-1 text-3xl font-semibold">{stats.attendanceThisMonth}</p>
    </div>
    {#if stats.givingThisMonthCents !== undefined}
      <div class="card p-5">
        <p class="text-sm text-slate-500">{$t('stat.giving')}</p>
        <p class="mt-1 text-3xl font-semibold force-ltr">{money(stats.givingThisMonthCents)}</p>
      </div>
    {/if}
  </div>
{/if}
