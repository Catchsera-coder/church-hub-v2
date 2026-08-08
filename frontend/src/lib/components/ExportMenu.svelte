<script lang="ts">
  import { get } from 'svelte/store';
  import { auth } from '$lib/stores/auth.js';
  import { locale, tr } from '$lib/i18n.js';

  // Export the given resource. CSV + Excel download from the backend; Print builds
  // a branded print-to-PDF (browser print) from the same data, with logo/date
  // toggles the exporter chooses. `params` carries the page's active filters so a
  // filtered view exports only those rows (empty → everyone).
  let { resource, title, params = '' }: { resource: string; title: string; params?: string } = $props();

  let open = $state(false);
  let busy = $state(false);
  let withLogo = $state(true);
  let withDate = $state(true);

  const filtered = $derived(params.replace(/^[?&]+/, '').length > 0);

  async function fetchBlob(format: 'csv' | 'xlsx'): Promise<Blob> {
    const token = get(auth).accessToken;
    const extra = params.replace(/^[?&]+/, '');
    const url = `/api/export/${resource}?format=${format}${extra ? '&' + extra : ''}`;
    const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new Error('Export failed');
    return res.blob();
  }

  async function download(format: 'csv' | 'xlsx') {
    busy = true;
    try {
      const blob = await fetchBlob(format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${resource}.${format}`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      open = false;
    } catch (e) { alert((e as Error).message); } finally { busy = false; }
  }

  // Minimal CSV parse (our export uses BOM, CRLF, and "" escaping).
  function parseCsv(text: string): string[][] {
    const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
    const s = text.replace(/^﻿/, '');
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (q) {
        if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (ch !== '\r') cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.length && r.some((c) => c !== ''));
  }

  async function printPdf() {
    busy = true;
    try {
      const [csv, settings] = await Promise.all([
        fetchBlob('csv').then((b) => b.text()),
        fetch('/api/settings').then((r) => r.json()).catch(() => ({ data: {} })),
      ]);
      const rows = parseCsv(csv);
      const headers = rows.shift() ?? [];
      const org = settings.data ?? {};
      const brand = /^#([0-9a-fA-F]{6})$/.test(org.brandColor ?? '') ? org.brandColor : '#3b3f8c';
      const name = (org.name?.en ?? org.name?.ar ?? '').replace(/</g, '&lt;');
      const now = new Date().toLocaleString();
      const esc = (s: string) => String(s ?? '').replace(/</g, '&lt;');
      const logo = withLogo && org.logoPath && /^data:image\//.test(org.logoPath) ? `<img src="${org.logoPath}" style="height:44px;object-fit:contain"/>` : '';
      const head = `<div style="display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid ${brand};padding-bottom:10px;margin-bottom:14px">
        <div>${logo || `<div style="font-size:18px;font-weight:700;color:${brand}">${name}</div>`}<div style="font-size:16px;font-weight:600;margin-top:4px">${esc(title)}</div></div>
        ${withDate ? `<div style="text-align:right;font-size:11px;color:#666">${esc(name)}<br/>${now}</div>` : ''}</div>`;
      const thead = `<tr>${headers.map((h) => `<th style="text-align:start;border-bottom:2px solid #ddd;padding:6px 8px;font-size:12px">${esc(h)}</th>`).join('')}</tr>`;
      const tbody = rows.map((r) => `<tr>${r.map((c) => `<td style="border-bottom:1px solid #eee;padding:6px 8px;font-size:12px">${esc(c)}</td>`).join('')}</tr>`).join('');
      const footer = withDate ? `<div style="margin-top:14px;text-align:center;color:#999;font-size:10px">${esc(name)} · ${now} · ${rows.length} ${tr({ en: 'rows', ar: 'صفوف' }, $locale)}</div>` : '';
      const w = window.open('', '_blank');
      if (!w) return;
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title></head>
        <body style="font-family:system-ui,sans-serif;padding:24px;color:#111">${head}
        <table style="width:100%;border-collapse:collapse">${thead}${tbody}</table>${footer}
        <script>window.onload=function(){window.print()}<\/script></body></html>`);
      w.document.close();
      open = false;
    } catch (e) { alert((e as Error).message); } finally { busy = false; }
  }
</script>

<div class="relative inline-block">
  <button class="btn-ghost border border-slate-300 text-sm dark:border-slate-700" onclick={() => (open = !open)} disabled={busy}>
    {busy ? '…' : tr({ en: 'Export', ar: 'تصدير' }, $locale)} ▾
  </button>
  {#if open}
    <button class="fixed inset-0 z-10 cursor-default" aria-label="close" onclick={() => (open = false)}></button>
    <div class="absolute end-0 z-20 mt-1 w-60 rounded-lg border border-slate-200 bg-white p-2 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900">
      <p class="px-3 pb-1 pt-1 text-xs {filtered ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'}">
        {filtered ? tr({ en: 'Only the current filter', ar: 'المرشّح الحالي فقط' }, $locale) : tr({ en: 'All records', ar: 'كل السجلات' }, $locale)}
      </p>
      <button class="block w-full rounded px-3 py-2 text-start hover:bg-slate-100 dark:hover:bg-slate-800" onclick={() => download('xlsx')}>📊 {tr({ en: 'Excel (.xlsx)', ar: 'إكسل (.xlsx)' }, $locale)}</button>
      <button class="block w-full rounded px-3 py-2 text-start hover:bg-slate-100 dark:hover:bg-slate-800" onclick={() => download('csv')}>📄 {tr({ en: 'CSV', ar: 'CSV' }, $locale)}</button>
      <button class="block w-full rounded px-3 py-2 text-start hover:bg-slate-100 dark:hover:bg-slate-800" onclick={printPdf}>🖨 {tr({ en: 'Print / PDF', ar: 'طباعة / PDF' }, $locale)}</button>
      <div class="mt-1 border-t border-slate-100 px-3 pt-2 text-xs text-slate-500 dark:border-slate-800">
        <p class="mb-1">{tr({ en: 'On print:', ar: 'عند الطباعة:' }, $locale)}</p>
        <label class="flex items-center gap-2 py-0.5"><input type="checkbox" bind:checked={withLogo} /> {tr({ en: 'Church logo', ar: 'شعار الكنيسة' }, $locale)}</label>
        <label class="flex items-center gap-2 py-0.5"><input type="checkbox" bind:checked={withDate} /> {tr({ en: 'Date & footer', ar: 'التاريخ والتذييل' }, $locale)}</label>
      </div>
    </div>
  {/if}
</div>
