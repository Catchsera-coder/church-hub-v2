<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import { hasRole } from '$lib/stores/auth.js';
  import PageHint from '$lib/components/PageHint.svelte';

  interface Finding {
    id: number; code: string; category: string; severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
    title: string; detail: string; recommendation: string; autofixable: boolean; status: string;
    lastSeenAt: string; firstSeenAt: string;
  }
  interface Scan { id: number; startedAt: string; finishedAt: string | null; trigger: string; openCount: number; autoFixed: number; summary: Record<string, number> }

  let loading = $state(true);
  let findings = $state<Finding[]>([]);
  let lastScan = $state<Scan | null>(null);
  let score = $state(100);
  let scanning = $state(false);
  let busyId = $state<number | null>(null);
  let note = $state('');

  const SEV = {
    critical: { en: 'Critical', ar: 'حرج', cls: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200', dot: 'bg-rose-500' },
    high: { en: 'High', ar: 'عالٍ', cls: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200', dot: 'bg-orange-500' },
    medium: { en: 'Medium', ar: 'متوسط', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200', dot: 'bg-amber-500' },
    low: { en: 'Low', ar: 'منخفض', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200', dot: 'bg-sky-500' },
    info: { en: 'Info', ar: 'معلومة', cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300', dot: 'bg-slate-400' },
  } as const;
  const OWASP: Record<string, { en: string; ar: string }> = {
    A01: { en: 'Access control', ar: 'التحكم بالوصول' }, A02: { en: 'Cryptography', ar: 'التشفير' },
    A05: { en: 'Misconfiguration', ar: 'إعداد خاطئ' }, A07: { en: 'Authentication', ar: 'المصادقة' },
    A09: { en: 'Logging', ar: 'التسجيل' },
  };
  const grade = $derived(score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 55 ? 'D' : 'F');
  const gradeColor = $derived(score >= 80 ? '#16a34a' : score >= 55 ? '#d97706' : '#dc2626');

  async function load() {
    loading = true;
    try {
      const { data } = await api<{ data: { findings: Finding[]; lastScan: Scan | null; score: number } }>('/security/overview');
      findings = data.findings; lastScan = data.lastScan; score = data.score;
    } finally { loading = false; }
  }

  // Auto-sync: re-run the scan (no auto-heal) so anything resolved — by a one-click
  // fix or a deployed code change — clears itself, then refresh the list.
  async function syncThenLoad() {
    try { await api('/security/scan', { method: 'POST', body: '{}' }); } catch { /* best-effort reconcile */ }
    await load();
  }

  async function runScan() {
    scanning = true; note = '';
    try {
      const { data } = await api<{ data: { open: number; autoFixed: number } }>('/security/scan', { method: 'POST', body: '{}' });
      note = tr({ en: `Scan complete — ${data.open} open finding(s).`, ar: `اكتمل الفحص — ${data.open} ملاحظة مفتوحة.` }, $locale);
      await load();
    } catch (e) { note = (e as Error).message; } finally { scanning = false; }
  }

  async function fix(f: Finding) {
    busyId = f.id; note = '';
    try {
      const { data } = await api<{ data: { fixed: boolean; detail?: string; requested?: boolean } }>(`/security/findings/${f.id}/fix`, { method: 'POST', body: '{}' });
      note = data.fixed
        ? tr({ en: `Fixed: ${data.detail ?? ''}`, ar: `تم الإصلاح: ${data.detail ?? ''}` }, $locale)
        : tr({ en: 'Flagged for a reviewed fix — this one needs a code change, not an automatic one.', ar: 'تم وضع علامة لإصلاح مُراجَع — يحتاج تغييراً برمجياً وليس تلقائياً.' }, $locale);
      await syncThenLoad();
    } catch (e) { note = (e as Error).message; } finally { busyId = null; }
  }

  async function dismiss(f: Finding) {
    if (!confirm(tr({ en: 'Dismiss this finding? It will not show again unless it changes.', ar: 'تجاهل هذه الملاحظة؟ لن تظهر مجدداً ما لم تتغير.' }, $locale))) return;
    busyId = f.id;
    try { await api(`/security/findings/${f.id}/dismiss`, { method: 'POST', body: '{}' }); await syncThenLoad(); }
    catch (e) { note = (e as Error).message; } finally { busyId = null; }
  }

  const fmt = (s: string | null) => (s ? new Date(s).toLocaleString() : '—');

  onMount(() => {
    if (!hasRole('Super Admin')) { goto('/dashboard', { replaceState: true }); return; }
    syncThenLoad();
  });
</script>

<div class="mb-6 flex flex-wrap items-center justify-between gap-3">
  <h1 class="text-2xl font-semibold">🛡️ {tr({ en: 'Security Center', ar: 'مركز الأمان' }, $locale)}</h1>
  <button class="btn-primary text-sm" disabled={scanning} onclick={runScan}>{scanning ? tr({ en: 'Scanning…', ar: 'جارٍ الفحص…' }, $locale) : tr({ en: '🔍 Run a scan now', ar: '🔍 افحص الآن' }, $locale)}</button>
</div>

<PageHint id="security-center" text={{ en: 'An automatic weekly check of your whole system against common security risks (NIST / OWASP). Safe clean-ups can be fixed in one click; deeper issues show clear steps for a reviewed update. It runs on its own each week and fixes the safe items even when no one is signed in.', ar: 'فحص أسبوعي تلقائي لنظامك بالكامل مقابل مخاطر الأمان الشائعة (NIST / OWASP). الإصلاحات الآمنة بضغطة واحدة، والمسائل الأعمق تظهر بخطوات واضحة لتحديث مُراجَع. يعمل أسبوعياً ويصلح الآمن تلقائياً حتى بدون تسجيل دخول أحد.' }} />

{#if loading}
  <p class="text-slate-400">{$t('common.loading')}</p>
{:else}
  <div class="mb-5 grid gap-4 sm:grid-cols-3">
    <div class="card flex items-center gap-4 p-5">
      <div class="flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-3xl font-bold text-white" style="background: {gradeColor}">{grade}</div>
      <div>
        <div class="text-2xl font-semibold leading-none">{score}<span class="text-base text-slate-400">/100</span></div>
        <div class="mt-1 text-sm text-slate-500">{tr({ en: 'Security score', ar: 'درجة الأمان' }, $locale)}</div>
      </div>
    </div>
    <div class="card p-5 sm:col-span-2">
      <div class="text-sm text-slate-500">{tr({ en: 'Last checked', ar: 'آخر فحص' }, $locale)}: <span class="text-slate-700 dark:text-slate-200">{fmt(lastScan?.finishedAt ?? lastScan?.startedAt ?? null)}</span></div>
      {#if lastScan}
        <div class="mt-1 text-xs text-slate-400">
          {lastScan.trigger === 'scheduled' ? tr({ en: 'Automatic weekly scan', ar: 'فحص أسبوعي تلقائي' }, $locale) : tr({ en: 'Manual scan', ar: 'فحص يدوي' }, $locale)}
          {#if lastScan.autoFixed}· <span class="text-emerald-600 dark:text-emerald-400">{tr({ en: `${lastScan.autoFixed} auto-healed`, ar: `${lastScan.autoFixed} أُصلحت تلقائياً` }, $locale)}</span>{/if}
        </div>
      {/if}
      <div class="mt-2 text-sm">{findings.length
        ? tr({ en: `${findings.length} open finding(s) to review.`, ar: `${findings.length} ملاحظة مفتوحة للمراجعة.` }, $locale)
        : tr({ en: 'No open issues — everything looks good. 🎉', ar: 'لا مشاكل مفتوحة — كل شيء على ما يُرام. 🎉' }, $locale)}</div>
    </div>
  </div>

  {#if note}<div class="mb-4 rounded-lg bg-slate-100 px-4 py-2 text-sm dark:bg-slate-800">{note}</div>{/if}

  <div class="space-y-3">
    {#each findings as f (f.id)}
      <div class="card p-5">
        <div class="flex flex-wrap items-start gap-3">
          <span class="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full {SEV[f.severity].dot}"></span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="rounded-full px-2 py-0.5 text-xs font-semibold {SEV[f.severity].cls}">{tr(SEV[f.severity], $locale)}</span>
              {#if OWASP[f.category]}<span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">{f.category} · {tr(OWASP[f.category], $locale)}</span>{/if}
              {#if f.status === 'fix_requested'}<span class="rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200">{tr({ en: 'Fix requested', ar: 'طُلب الإصلاح' }, $locale)}</span>{/if}
            </div>
            <h3 class="mt-1.5 font-semibold">{f.title}</h3>
            <p class="mt-1 text-sm text-slate-600 dark:text-slate-300">{f.detail}</p>
            <p class="mt-1.5 text-sm text-slate-500"><span class="font-medium">{tr({ en: 'What to do', ar: 'ما العمل' }, $locale)}:</span> {f.recommendation}</p>
          </div>
          <div class="flex shrink-0 flex-col gap-2">
            {#if f.autofixable}
              <button class="rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50" style="background: var(--brand)" disabled={busyId === f.id} onclick={() => fix(f)}>{busyId === f.id ? '…' : tr({ en: '✓ Fix now', ar: '✓ أصلح الآن' }, $locale)}</button>
            {:else if f.status !== 'fix_requested'}
              <button class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800" disabled={busyId === f.id} onclick={() => fix(f)}>{busyId === f.id ? '…' : tr({ en: 'Request fix', ar: 'اطلب الإصلاح' }, $locale)}</button>
            {/if}
            <button class="text-xs text-slate-400 hover:text-slate-600 hover:underline dark:hover:text-slate-200" disabled={busyId === f.id} onclick={() => dismiss(f)}>{tr({ en: 'Dismiss', ar: 'تجاهل' }, $locale)}</button>
          </div>
        </div>
      </div>
    {/each}
  </div>
{/if}
