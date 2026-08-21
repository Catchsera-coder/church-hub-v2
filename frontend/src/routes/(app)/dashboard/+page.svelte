<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { t, locale, tr, displayName } from '$lib/i18n.js';
  import { nameOrder } from '$lib/stores/prefs.js';
  import { can } from '$lib/stores/auth.js';
  import PageHint from '$lib/components/PageHint.svelte';

  interface ServiceCount { name: Record<string, string> | null; count: number }
  interface Stats {
    members: number; households: number; attendanceThisMonth: number;
    newMembersThisMonth: number; awaitingApproval: number; birthdaysThisMonth: number;
    upcomingGatherings: number; attendanceByService: ServiceCount[];
    liveGathering?: { id: number; title: Record<string, string>; startsAt: string; publicToken: string } | null;
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
    upcoming: { label: { en: 'Upcoming attendance', ar: 'الحضور القادم' }, value: (s) => s.upcomingGatherings, href: '/attendance', emoji: '📅' },
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

  // Pastoral care + clearance-expiry cards (independent of the toggleable widgets).
  let care = $state<{ open: number; mine: number; overdue: number } | null>(null);
  let expiring = $state<any[]>([]);
  onMount(async () => {
    if (can('view care')) { try { care = (await api<{ data: any }>('/care/counts')).data; } catch { /* optional */ } }
    if (can('view person')) { try { expiring = (await api<{ data: any[] }>('/people/clearances/expiring?days=45')).data; } catch { /* optional */ } }
  });
  const today = new Date().toISOString().slice(0, 10);
</script>

<h1 class="mb-4 text-2xl font-semibold">{$t('nav.dashboard')}</h1>
<PageHint id="dashboard" text={{ en: 'A snapshot of your church — members, families, attendance, birthdays and more. Choose which cards appear from Settings → Dashboard. Tips like this can be turned off in Settings.', ar: 'لمحة عن كنيستك — الأعضاء والعائلات والحضور وأعياد الميلاد. اختر البطاقات الظاهرة من الإعدادات ← لوحة المعلومات. يمكن إيقاف هذه التلميحات من الإعدادات.' }} />

{#if (care && care.open > 0) || expiring.length}
  <div class="mb-4 grid gap-4 sm:grid-cols-2">
    {#if care && care.open > 0}
      <a href="/care" class="card flex items-center gap-4 p-5 transition hover:shadow-md">
        <span class="text-3xl">❤️</span>
        <div class="flex-1">
          <div class="text-2xl font-semibold leading-none">{care.open}</div>
          <div class="mt-1 text-sm text-slate-500">{tr({ en: 'Open care items', ar: 'عناصر رعاية مفتوحة' }, $locale)}</div>
          <div class="mt-1 text-xs text-slate-400">{care.mine} {tr({ en: 'assigned to you', ar: 'مسندة إليك' }, $locale)}{#if care.overdue} · <span class="text-rose-600 dark:text-rose-400">{care.overdue} {tr({ en: 'overdue', ar: 'متأخرة' }, $locale)}</span>{/if}</div>
        </div>
      </a>
    {/if}
    {#if expiring.length}
      <div class="card p-5">
        <div class="mb-2 flex items-center gap-2"><span class="text-xl">🛡️</span><span class="font-semibold">{tr({ en: 'Clearances expiring soon', ar: 'تصاريح تنتهي قريباً' }, $locale)}</span><span class="ms-auto rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{expiring.length}</span></div>
        <ul class="space-y-1 text-sm">
          {#each expiring.slice(0, 4) as e}
            <li class="flex items-center gap-2"><a class="min-w-0 flex-1 truncate text-primary-700 hover:underline dark:text-primary-300" href="/members/{e.personId}">{displayName({ givenName: e.givenName, familyName: e.familyName }, $nameOrder, $locale)}</a><span class="force-ltr text-xs {e.expiresOn < today ? 'font-medium text-rose-600 dark:text-rose-400' : 'text-slate-400'}">{e.expiresOn}</span></li>
          {/each}
        </ul>
        {#if expiring.length > 4}<p class="mt-1 text-xs text-slate-400">+{expiring.length - 4} {tr({ en: 'more', ar: 'أخرى' }, $locale)}</p>{/if}
      </div>
    {/if}
  </div>
{/if}

{#if stats?.liveGathering}
  {@const g = stats.liveGathering}
  <div class="mb-6 flex flex-wrap items-center gap-3 rounded-2xl p-4 text-white shadow-sm" style="background: var(--brand)">
    <span class="relative flex h-3 w-3"><span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70"></span><span class="relative inline-flex h-3 w-3 rounded-full bg-white"></span></span>
    <div class="flex-1">
      <p class="text-sm opacity-90">{tr({ en: 'Happening now', ar: 'يحدث الآن' }, $locale)}</p>
      <p class="text-lg font-bold">{tr(g.title, $locale)}</p>
    </div>
    <a href="/checkin" class="rounded-lg bg-white/20 px-4 py-2 text-sm font-medium hover:bg-white/30">{tr({ en: 'Open check-in', ar: 'فتح التسجيل' }, $locale)}</a>
    <a href="/attendance/{g.id}" class="rounded-lg bg-white px-4 py-2 text-sm font-medium" style="color: var(--brand)">{tr({ en: 'View', ar: 'عرض' }, $locale)}</a>
  </div>
{/if}

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
