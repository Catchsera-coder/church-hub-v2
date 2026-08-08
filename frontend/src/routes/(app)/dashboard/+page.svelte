<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';

  interface ServiceCount { name: Record<string, string> | null; count: number }
  interface Stats {
    members: number; households: number; attendanceThisMonth: number;
    newMembersThisMonth: number; awaitingApproval: number; birthdaysThisMonth: number;
    upcomingGatherings: number; attendanceByService: ServiceCount[];
    givingThisMonthCents?: number;
  }
  let stats = $state<Stats | null>(null);
  let loading = $state(true);

  type Widget = { label: Record<string, string>; value: (s: Stats) => number | undefined; money?: boolean; href?: string; emoji?: string };
  // Simple count/number widgets. 'services' (attendance-by-service) renders separately.
  const CATALOG: Record<string, Widget> = {
    members: { label: { en: 'Members', ar: 'الأعضاء' }, value: (s) => s.members },
    families: { label: { en: 'Families', ar: 'العائلات' }, value: (s) => s.households },
    attendance: { label: { en: 'Attendance this month', ar: 'الحضور هذا الشهر' }, value: (s) => s.attendanceThisMonth },
    newMembers: { label: { en: 'New this month', ar: 'جدد هذا الشهر' }, value: (s) => s.newMembersThisMonth, emoji: '✨' },
    awaitingApproval: { label: { en: 'Awaiting approval', ar: 'بانتظار الموافقة' }, value: (s) => s.awaitingApproval, href: '/members', emoji: '🔔' },
    birthdays: { label: { en: 'Birthdays this month', ar: 'أعياد ميلاد هذا الشهر' }, value: (s) => s.birthdaysThisMonth, emoji: '🎂' },
    upcoming: { label: { en: 'Upcoming gatherings', ar: 'الاجتماعات القادمة' }, value: (s) => s.upcomingGatherings, href: '/attendance', emoji: '📅' },
    giving: { label: { en: 'Giving this month', ar: 'العطاء هذا الشهر' }, value: (s) => s.givingThisMonthCents, money: true },
  };
  const DEFAULT_WIDGETS = ['members', 'families', 'attendance', 'newMembers', 'awaitingApproval', 'birthdays', 'upcoming', 'services', 'giving'];
  let widgets = $state<string[]>(DEFAULT_WIDGETS);
  let currency = $state('USD');

  const showServices = $derived(widgets.includes('services'));
  const countWidgets = $derived(widgets.filter((k) => k in CATALOG));
  const maxService = $derived(stats ? Math.max(1, ...stats.attendanceByService.map((s) => s.count)) : 1);

  onMount(async () => {
    try {
      const [s, settings] = await Promise.all([
        api<{ data: Stats }>('/dashboard/stats'),
        api<{ data: { currency?: string; dashboard?: { widgets?: string[] } } }>('/settings'),
      ]);
      stats = s.data;
      if (settings.data.currency) currency = settings.data.currency;
      const cfg = settings.data.dashboard?.widgets;
      if (cfg && cfg.length) widgets = cfg.filter((k) => k in CATALOG || k === 'services');
    } finally {
      loading = false;
    }
  });

  const money = (cents: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
</script>

<h1 class="mb-6 text-2xl font-semibold">{$t('nav.dashboard')}</h1>

{#if loading}
  <p class="text-slate-400">{$t('common.loading')}</p>
{:else if stats}
  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
    {#each countWidgets as key}
      {@const w = CATALOG[key]}
      {@const val = w?.value(stats)}
      <!-- Giving is permission-gated server-side (omitted → drops off silently). -->
      {#if w && val !== undefined}
        {#snippet tile()}
          <p class="text-sm text-slate-500">{w.emoji ? w.emoji + ' ' : ''}{tr(w.label, $locale)}</p>
          <p class="mt-1 text-3xl font-semibold {w.money ? 'force-ltr' : ''}" style={key === 'awaitingApproval' && val > 0 ? 'color: var(--brand)' : ''}>{w.money ? money(val) : val}</p>
        {/snippet}
        {#if w.href && val > 0}
          <a href={w.href} class="card p-5 transition hover:shadow-md">{@render tile()}</a>
        {:else}
          <div class="card p-5">{@render tile()}</div>
        {/if}
      {/if}
    {/each}
  </div>

  {#if showServices && stats.attendanceByService.length}
    <div class="card mt-4 p-6">
      <h2 class="mb-4 text-lg font-semibold">{tr({ en: 'Attendance by service — this month', ar: 'الحضور حسب الخدمة — هذا الشهر' }, $locale)}</h2>
      <div class="space-y-3">
        {#each stats.attendanceByService as s}
          <div>
            <div class="mb-1 flex items-center justify-between text-sm">
              <span class="text-slate-700 dark:text-slate-200">{s.name ? tr(s.name, $locale) : tr({ en: 'General', ar: 'عام' }, $locale)}</span>
              <span class="font-medium text-slate-500">{s.count}</span>
            </div>
            <div class="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div class="h-full rounded-full" style="width: {Math.round((s.count / maxService) * 100)}%; background-color: var(--brand)"></div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
{/if}
