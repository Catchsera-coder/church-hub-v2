<script lang="ts">
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api.js';
  import { auth } from '$lib/stores/auth.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import PageHeader from '$lib/components/PageHeader.svelte';

  type Row = { index: number; values: Record<string, string>; errors: string[]; warnings: string[] };
  let rows = $state<Row[]>([]);
  let summary = $state<{ total: number; ok: number; errors: number } | null>(null);
  let busy = $state(false);
  let error = $state('');
  let done = $state<number | null>(null);

  async function downloadTemplate() {
    const token = get(auth).accessToken;
    const res = await fetch('/api/import/members/template', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'members-template.xlsx'; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function onFile(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    error = ''; rows = []; summary = null; done = null;
    const reader = new FileReader();
    reader.onload = async () => {
      busy = true;
      try {
        const r = await api<{ data: { rows: Row[]; summary: any } }>('/import/members/preview', {
          method: 'POST', body: JSON.stringify({ filename: file.name, base64: reader.result as string }),
        });
        rows = r.data.rows; summary = r.data.summary;
      } catch (err) { error = err instanceof ApiError ? err.message : (err as Error).message; }
      finally { busy = false; }
    };
    reader.readAsDataURL(file);
  }

  async function doImport() {
    const valid = rows.filter((r) => r.errors.length === 0).map((r) => r.values);
    if (!valid.length) return;
    busy = true; error = '';
    try {
      const r = await api<{ data: { created: number } }>('/import/members', { method: 'POST', body: JSON.stringify({ rows: valid }) });
      done = r.data.created;
    } catch (err) { error = err instanceof ApiError ? err.message : (err as Error).message; }
    finally { busy = false; }
  }
</script>

<PageHeader title={tr({ en: 'Import members', ar: 'استيراد الأعضاء' }, $locale)} back="/members" />

{#if done !== null}
  <div class="card p-8 text-center">
    <div class="mb-3 text-4xl">✅</div>
    <p class="text-lg font-semibold">{done} {tr({ en: 'members imported.', ar: 'عضواً تم استيرادهم.' }, $locale)}</p>
    <a href="/members" class="btn-primary mt-4 inline-block">{tr({ en: 'View members', ar: 'عرض الأعضاء' }, $locale)}</a>
  </div>
{:else}
  <div class="card mb-4 space-y-3 p-6">
    <p class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: '1. Download the template, fill in one row per person, and save it. 2. Upload it here — we’ll check each row before importing.', ar: '١. نزّل القالب، واملأ صفاً لكل شخص، واحفظه. ٢. ارفعه هنا — سنتحقق من كل صف قبل الاستيراد.' }, $locale)}</p>
    <div class="flex flex-wrap items-center gap-3">
      <button class="btn-ghost border border-slate-300 dark:border-slate-700" onclick={downloadTemplate}>⬇ {tr({ en: 'Download Excel template', ar: 'تنزيل قالب إكسل' }, $locale)}</button>
      <label class="btn-primary cursor-pointer">
        {tr({ en: 'Choose file (.xlsx / .csv)', ar: 'اختر ملفاً (.xlsx / .csv)' }, $locale)}
        <input type="file" accept=".xlsx,.csv" class="hidden" onchange={onFile} />
      </label>
      {#if busy}<span class="text-sm text-slate-400">{$t('common.loading')}</span>{/if}
    </div>
    {#if error}<p class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>{/if}
  </div>

  {#if summary}
    <div class="mb-3 flex flex-wrap items-center gap-4 text-sm">
      <span>{summary.total} {tr({ en: 'rows', ar: 'صف' }, $locale)}</span>
      <span class="text-emerald-600 dark:text-emerald-400">✓ {summary.ok} {tr({ en: 'ready', ar: 'جاهز' }, $locale)}</span>
      {#if summary.errors > 0}<span class="text-rose-600 dark:text-rose-400">✗ {summary.errors} {tr({ en: 'with errors (skipped)', ar: 'بها أخطاء (ستُتجاهل)' }, $locale)}</span>{/if}
      <button class="btn-primary ms-auto" onclick={doImport} disabled={busy || summary.ok === 0}>{tr({ en: `Import ${summary.ok} members`, ar: `استيراد ${summary.ok} عضواً` }, $locale)}</button>
    </div>

    <div class="card overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="border-b border-slate-200 text-start text-slate-500 dark:border-slate-800">
          <tr>
            <th class="p-2 text-start font-medium">#</th>
            <th class="p-2 text-start font-medium">{tr({ en: 'Name', ar: 'الاسم' }, $locale)}</th>
            <th class="p-2 text-start font-medium">{tr({ en: 'Email', ar: 'البريد' }, $locale)}</th>
            <th class="p-2 text-start font-medium">{tr({ en: 'Mobile', ar: 'الجوال' }, $locale)}</th>
            <th class="p-2 text-start font-medium">{tr({ en: 'Family', ar: 'العائلة' }, $locale)}</th>
            <th class="p-2 text-start font-medium">{tr({ en: 'Check', ar: 'التحقق' }, $locale)}</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as r}
            <tr class="border-b border-slate-100 last:border-0 {r.errors.length ? 'bg-rose-50/50 dark:bg-rose-900/10' : ''}">
              <td class="p-2 text-slate-400">{r.index}</td>
              <td class="p-2">{r.values.givenName} {r.values.familyName ?? ''}</td>
              <td class="p-2 force-ltr text-slate-600 dark:text-slate-300">{r.values.email ?? ''}</td>
              <td class="p-2 force-ltr text-slate-600 dark:text-slate-300">{r.values.mobile ?? ''}</td>
              <td class="p-2 text-slate-600 dark:text-slate-300">{r.values.household ?? ''}</td>
              <td class="p-2">
                {#if r.errors.length}<span class="text-xs text-rose-600 dark:text-rose-400">✗ {r.errors.join(', ')}</span>
                {:else if r.warnings.length}<span class="text-xs text-amber-600 dark:text-amber-400">⚠ {r.warnings.join(', ')}</span>
                {:else}<span class="text-xs text-emerald-600 dark:text-emerald-400">✓</span>{/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
{/if}
