<script lang="ts">
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api.js';
  import { auth } from '$lib/stores/auth.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import PageHeader from '$lib/components/PageHeader.svelte';

  type Row = { index: number; values: Record<string, string>; errors: string[]; warnings: string[] };
  type Mapping = { header: string; field: string | null };
  type Field = { key: string; label: string };
  let rows = $state<Row[]>([]);
  let summary = $state<{ total: number; ok: number; errors: number } | null>(null);
  let mapping = $state<Mapping[]>([]);
  let fields = $state<Field[]>([]);
  let overrides = $state<Record<string, string>>({});
  let fileB64 = $state('');
  let fileName = $state('');
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
    error = ''; rows = []; summary = null; done = null; overrides = {}; mapping = [];
    fileName = file.name;
    const reader = new FileReader();
    reader.onload = async () => { fileB64 = reader.result as string; await runPreview(); };
    reader.readAsDataURL(file);
  }

  async function runPreview() {
    busy = true; error = '';
    try {
      const r = await api<{ data: { rows: Row[]; summary: any; mapping: Mapping[]; fields: Field[] } }>('/import/members/preview', {
        method: 'POST', body: JSON.stringify({ filename: fileName, base64: fileB64, overrides }),
      });
      rows = r.data.rows; summary = r.data.summary; mapping = r.data.mapping; fields = r.data.fields;
    } catch (err) { error = err instanceof ApiError ? err.message : (err as Error).message; }
    finally { busy = false; }
  }

  // The user corrects a column → field on the confirm screen; re-run the preview.
  function setOverride(header: string, field: string) {
    overrides = { ...overrides, [header]: field };
    runPreview();
  }
  const fieldLabel = (key: string | null) => fields.find((f) => f.key === key)?.label ?? '';

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
    <p class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Upload any members spreadsheet (.xlsx or .csv) — we’ll automatically match its columns to the right fields, let you confirm the matching, and check every row before importing. No need to reformat; the template is just a convenient starting point.', ar: 'ارفع أي جدول أعضاء (.xlsx أو .csv) — سنطابق أعمدته بالحقول الصحيحة تلقائياً، وندعك تؤكّد المطابقة، ونتحقق من كل صف قبل الاستيراد. لا حاجة لإعادة التنسيق؛ القالب مجرد نقطة بداية مريحة.' }, $locale)}</p>
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

  {#if mapping.length}
    <div class="card mb-4 space-y-2 p-6">
      <p class="text-sm font-medium">🧠 {tr({ en: 'Column matching — we detected these; adjust any that are wrong', ar: 'مطابقة الأعمدة — اكتشفنا هذه؛ عدّل أي خطأ' }, $locale)}</p>
      <p class="text-xs text-slate-500 dark:text-slate-400">{tr({ en: 'Your spreadsheet’s headers were matched to the right fields automatically. Change a dropdown to re-map, or set it to “Ignore”.', ar: 'طُوبقت عناوين جدولك بالحقول الصحيحة تلقائياً. غيّر القائمة لإعادة المطابقة، أو اضبطها على «تجاهل».' }, $locale)}</p>
      <div class="grid gap-2 sm:grid-cols-2">
        {#each mapping as m}
          <div class="flex items-center gap-2 text-sm">
            <span class="force-ltr min-w-0 flex-1 truncate rounded bg-slate-100 px-2 py-1 text-slate-700 dark:bg-slate-800 dark:text-slate-200" title={m.header}>{m.header || '(blank)'}</span>
            <span class="text-slate-400">→</span>
            <select class="input max-w-[10rem] py-1 text-sm {m.field ? '' : 'text-slate-400'}" value={m.field ?? ''} onchange={(e) => setOverride(m.header, (e.currentTarget as HTMLSelectElement).value)}>
              <option value="">{tr({ en: '— Ignore —', ar: '— تجاهل —' }, $locale)}</option>
              {#each fields as f}<option value={f.key}>{f.label}</option>{/each}
            </select>
          </div>
        {/each}
      </div>
    </div>
  {/if}

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
