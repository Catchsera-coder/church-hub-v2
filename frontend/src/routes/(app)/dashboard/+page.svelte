<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { t } from '$lib/i18n.js';

  interface Stats { members: number; households: number; attendanceThisMonth: number; givingThisMonthCents?: number }
  let stats = $state<Stats | null>(null);
  let loading = $state(true);

  // Widget catalog — the customizable set (#17). Order/enabled come from the
  // church's dashboard config; an empty config falls back to all of them.
  const CATALOG: Record<string, { labelKey: string; value: (s: Stats) => number | undefined; money?: boolean }> = {
    members: { labelKey: 'stat.members', value: (s) => s.members },
    families: { labelKey: 'stat.families', value: (s) => s.households },
    attendance: { labelKey: 'stat.attendance', value: (s) => s.attendanceThisMonth },
    giving: { labelKey: 'stat.giving', value: (s) => s.givingThisMonthCents, money: true },
  };
  const DEFAULT_WIDGETS = ['members', 'families', 'attendance', 'giving'];
  let widgets = $state<string[]>(DEFAULT_WIDGETS);

  onMount(async () => {
    try {
      const [s, settings] = await Promise.all([
        api<{ data: Stats }>('/dashboard/stats'),
        api<{ data: { dashboard?: { widgets?: string[] } } }>('/settings'),
      ]);
      stats = s.data;
      const cfg = settings.data.dashboard?.widgets;
      if (cfg && cfg.length) widgets = cfg.filter((k) => k in CATALOG);
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
    {#each widgets as key}
      {@const w = CATALOG[key]}
      {@const val = w?.value(stats)}
      <!-- Giving is permission-gated server-side: omitted from stats when the
           user may not view it, so it silently drops off the dashboard. -->
      {#if w && val !== undefined}
        <div class="card p-5">
          <p class="text-sm text-slate-500">{$t(w.labelKey)}</p>
          <p class="mt-1 text-3xl font-semibold {w.money ? 'force-ltr' : ''}">{w.money ? money(val) : val}</p>
        </div>
      {/if}
    {/each}
  </div>
{/if}
