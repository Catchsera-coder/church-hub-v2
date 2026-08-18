<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';

  interface LC { label: string; count: number }
  interface MC { label: string; cents: number }
  let data = $state<{ attendanceTrend: LC[]; attendanceByMinistry: LC[]; newMembersByMonth: LC[]; givingByMonth?: MC[] } | null>(null);
  let currency = $state('USD');
  let loading = $state(true);

  onMount(async () => {
    try {
      const [a, s] = await Promise.all([
        api<{ data: any }>('/analytics/overview'),
        api<{ data: { currency?: string } }>('/settings'),
      ]);
      data = a.data;
      if (s.data.currency) currency = s.data.currency;
    } finally { loading = false; }
  });

  const money = (cents: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100);
  const max = (arr: { count?: number; cents?: number }[], key: 'count' | 'cents') => Math.max(1, ...arr.map((x) => (x[key] as number) ?? 0));
</script>

<h1 class="mb-6 text-2xl font-semibold">{tr({ en: 'Analytics', ar: 'التحليلات' }, $locale)}</h1>

{#if loading}
  <p class="text-slate-400">{$t('common.loading')}</p>
{:else if data}
  {#snippet barCard(title: Record<string, string>, rows: LC[], fmt: (n: number) => string)}
    <div class="card p-6">
      <h2 class="mb-4 text-lg font-semibold">{tr(title, $locale)}</h2>
      {#if rows.length === 0}
        <p class="text-sm text-slate-400">{tr({ en: 'No data yet.', ar: 'لا توجد بيانات بعد.' }, $locale)}</p>
      {:else}
        {@const m = max(rows, 'count')}
        <div class="space-y-2">
          {#each rows as r}
            <div>
              <div class="mb-1 flex items-center justify-between text-sm">
                <span class="text-slate-700 dark:text-slate-200">{r.label}</span>
                <span class="font-medium text-slate-500">{fmt(r.count)}</span>
              </div>
              <div class="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div class="h-full rounded-full" style="width: {Math.round((r.count / m) * 100)}%; background-color: var(--brand)"></div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/snippet}

  <div class="grid gap-4 lg:grid-cols-2">
    {@render barCard({ en: 'Attendance — last 12 weeks', ar: 'الحضور — آخر 12 أسبوعاً' }, data.attendanceTrend, (n) => String(n))}
    {@render barCard({ en: 'Attendance by ministry (3 months)', ar: 'الحضور حسب الخدمة (3 أشهر)' }, data.attendanceByMinistry, (n) => String(n))}
    {@render barCard({ en: 'New members — last 6 months', ar: 'أعضاء جدد — آخر 6 أشهر' }, data.newMembersByMonth, (n) => String(n))}

    {#if data.givingByMonth}
      <div class="card p-6">
        <h2 class="mb-4 text-lg font-semibold">{tr({ en: 'Giving — last 6 months', ar: 'العطاء — آخر 6 أشهر' }, $locale)}</h2>
        {#if data.givingByMonth.length === 0}
          <p class="text-sm text-slate-400">{tr({ en: 'No data yet.', ar: 'لا توجد بيانات بعد.' }, $locale)}</p>
        {:else}
          {@const gm = max(data.givingByMonth, 'cents')}
          <div class="space-y-2">
            {#each data.givingByMonth as r}
              <div>
                <div class="mb-1 flex items-center justify-between text-sm">
                  <span class="text-slate-700 dark:text-slate-200">{r.label}</span>
                  <span class="force-ltr font-medium text-slate-500">{money(r.cents)}</span>
                </div>
                <div class="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div class="h-full rounded-full" style="width: {Math.round((r.cents / gm) * 100)}%; background-color: var(--brand)"></div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}
