<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import * as QRCode from 'qrcode';
  import { api } from '$lib/api.js';
  import { t, tr, locale, displayName } from '$lib/i18n.js';
  import { nameOrder } from '$lib/stores/prefs.js';
  import { can } from '$lib/stores/auth.js';
  import { resolveStreamLink } from '$lib/stream.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import PageHint from '$lib/components/PageHint.svelte';
  import MinistryForm from '$lib/components/MinistryForm.svelte';
  import MinistryRoster from '$lib/components/MinistryRoster.svelte';
  import ServingRota from '$lib/components/ServingRota.svelte';

  const id = Number($page.params.id);
  let ministry = $state<any>(null);
  let loading = $state(true);
  let editing = $state(false);
  let anniversaries = $state<any[]>([]);

  async function loadMinistry() { ministry = (await api<{ data: any }>(`/ministries/${id}`)).data; }
  onMount(async () => {
    try {
      await loadMinistry();
      try { anniversaries = (await api<{ data: any[] }>(`/ministries/${id}/anniversaries`)).data; } catch { anniversaries = []; }
    } finally { loading = false; }
  });

  const isGroup = $derived(ministry?.kind === 'group');
  const streamLink = $derived(ministry?.streaming ? resolveStreamLink(ministry.streaming) : '');
  const meeting = $derived.by(() => {
    if (!ministry) return '';
    return [ministry.meetingDay, ministry.meetingTime].filter(Boolean).join(' · ');
  });

  // Public sign-up QR
  let qr = $state('');
  const signupUrl = $derived(typeof window !== 'undefined' && ministry?.openToSignup ? `${window.location.origin}/join/${ministry.publicToken}` : '');
  let copied = $state(false);
  $effect(() => {
    const u = signupUrl;
    if (!u) { qr = ''; return; }
    QRCode.toDataURL(u, { width: 220, margin: 1 }).then((d) => (qr = d)).catch(() => (qr = ''));
  });
  async function copySignup() { try { await navigator.clipboard.writeText(signupUrl); copied = true; setTimeout(() => (copied = false), 1500); } catch { /* ignore */ } }

  async function onSaved() { editing = false; await loadMinistry(); }
</script>

<PageHeader title={ministry ? tr(ministry.name, $locale) : tr({ en: 'Ministry', ar: 'الخدمة' }, $locale)} back="/ministries">
  {#snippet actions()}
    {#if can('update ministry')}
      <button class="btn-ghost border border-slate-300 text-sm dark:border-slate-700" onclick={() => (editing = !editing)}>{editing ? tr({ en: '✕ Close', ar: '✕ إغلاق' }, $locale) : tr({ en: '✎ Edit details', ar: '✎ تعديل التفاصيل' }, $locale)}</button>
    {/if}
  {/snippet}
</PageHeader>

<PageHint id="ministry-detail" text={{ en: 'Add people to the team and give each a role (leader, coordinator, volunteer). Use the Serving rota to schedule who serves on each date and send reminders. Turn on public sign-up to share a join link.', ar: 'أضف أشخاصاً للفريق وحدّد دور كل منهم. استخدم جدول الخدمة لتحديد من يخدم في كل تاريخ وإرسال التذكيرات. فعّل التسجيل العام لمشاركة رابط الانضمام.' }} />

{#if loading}
  <p class="text-slate-400">{$t('common.loading')}</p>
{:else if ministry}
  <!-- Summary header -->
  <div class="card mb-6 p-5 sm:p-6">
    <div class="flex flex-wrap items-start gap-4">
      <span class="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-2xl" style="background: color-mix(in srgb, var(--brand) 15%, transparent)">{isGroup ? '🏡' : '🙌'}</span>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <h1 class="text-xl font-semibold">{tr(ministry.name, $locale)}</h1>
          <span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{isGroup ? tr({ en: 'Small group', ar: 'مجموعة صغيرة' }, $locale) : tr({ en: 'Ministry', ar: 'خدمة' }, $locale)}</span>
          {#if ministry.category}<span class="rounded-full px-2 py-0.5 text-xs" style="background: color-mix(in srgb, var(--brand) 12%, transparent); color: var(--brand)">{ministry.category}</span>{/if}
          {#if !ministry.isActive}<span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800">{tr({ en: 'inactive', ar: 'غير مفعّل' }, $locale)}</span>{/if}
        </div>
        {#if ministry.description && tr(ministry.description, $locale)}<p class="mt-1 text-sm text-slate-500 dark:text-slate-400">{tr(ministry.description, $locale)}</p>{/if}
        <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
          {#if ministry.leader}<span>👤 {displayName(ministry.leader, $nameOrder, $locale)}</span>{/if}
          {#if meeting}<span>🗓️ {meeting}</span>{/if}
          {#if ministry.location}<span>📍 {ministry.location}</span>{/if}
          {#if ministry.contactEmail}<a class="force-ltr hover:underline" href="mailto:{ministry.contactEmail}">✉️ {ministry.contactEmail}</a>{/if}
          {#if streamLink}<a class="force-ltr text-sky-600 hover:underline dark:text-sky-400" href={streamLink} target="_blank" rel="noopener">📺 {tr({ en: 'Live', ar: 'بث' }, $locale)}</a>{/if}
        </div>
      </div>
    </div>

    {#if anniversaries.length}
      <div class="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm dark:bg-amber-900/20">
        <span class="font-medium text-amber-800 dark:text-amber-200">🎉 {tr({ en: 'Serving anniversaries this month:', ar: 'ذكرى الخدمة هذا الشهر:' }, $locale)}</span>
        <span class="text-amber-700 dark:text-amber-300">
          {anniversaries.map((a) => `${displayName(a, $nameOrder, $locale)} (${a.years} ${tr({ en: 'yr', ar: 'سنة' }, $locale)})`).join(' · ')}
        </span>
      </div>
    {/if}
  </div>

  {#if editing}
    <div class="mb-6"><MinistryForm initial={ministry} {id} redirect={false} onsaved={onSaved} /></div>
  {/if}

  <div class="grid gap-6 lg:grid-cols-2 lg:items-start">
    <MinistryRoster ministryId={id} {ministry} />
    <ServingRota ministryId={id} />
  </div>

  <!-- Public sign-up -->
  {#if ministry.openToSignup}
    <div class="card mt-6 p-5 sm:p-6">
      <h2 class="mb-1 font-semibold">🔗 {tr({ en: 'Public sign-up', ar: 'التسجيل العام' }, $locale)}</h2>
      <p class="mb-3 text-sm text-slate-500 dark:text-slate-400">{tr({ en: 'Share this link or QR so people can volunteer. New sign-ups land in your review queue.', ar: 'شارك هذا الرابط أو رمز QR ليتطوّع الناس. تظهر التسجيلات الجديدة في قائمة المراجعة.' }, $locale)}</p>
      <div class="flex flex-wrap items-center gap-4">
        {#if qr}<img src={qr} alt="Sign-up QR" class="w-32 rounded-lg bg-white p-2" />{/if}
        <div class="flex-1">
          <div class="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800">
            <a href={signupUrl} target="_blank" rel="noopener" class="force-ltr truncate text-sky-600 hover:underline dark:text-sky-400">{signupUrl}</a>
            <button type="button" class="ms-auto shrink-0 text-slate-500 hover:underline" onclick={copySignup}>{copied ? tr({ en: 'Copied ✓', ar: 'تم النسخ ✓' }, $locale) : tr({ en: 'Copy', ar: 'نسخ' }, $locale)}</button>
          </div>
        </div>
      </div>
    </div>
  {/if}
{:else}
  <p class="text-slate-400">{tr({ en: 'Ministry not found.', ar: 'الخدمة غير موجودة.' }, $locale)}</p>
{/if}
