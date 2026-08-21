<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import PageHint from '$lib/components/PageHint.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

  interface Vendor { id: number; name: string; title: string | null; category: string | null; email: string | null; phone: string | null; mobile: string | null; website: string | null; notes: string | null; isActive?: boolean; }

  let rows = $state<Vendor[]>([]);
  let loading = $state(true);
  let search = $state('');
  let category = $state('');
  let timer: ReturnType<typeof setTimeout>;

  let editing = $state<Partial<Vendor> | null>(null);
  let saving = $state(false);
  let error = $state('');
  let confirmDel = $state<Vendor | null>(null);
  let deleting = $state(false);

  async function load() {
    loading = true;
    try {
      const q = new URLSearchParams();
      if (search.trim()) q.set('search', search.trim());
      if (category) q.set('category', category);
      rows = (await api<{ data: Vendor[] }>(`/vendors?${q}`)).data;
    } finally { loading = false; }
  }
  function onSearch() { clearTimeout(timer); timer = setTimeout(load, 300); }
  onMount(load);

  // Categories seen across ALL vendors (loaded once, unfiltered) → filter chips.
  let allCategories = $state<string[]>([]);
  onMount(async () => {
    try {
      const all = (await api<{ data: Vendor[] }>('/vendors')).data;
      allCategories = [...new Set(all.map((v) => v.category).filter((c): c is string => !!c))].sort();
    } catch { /* optional */ }
  });
  function pickCategory(c: string) { category = category === c ? '' : c; load(); }

  function startNew() { editing = { name: '', title: '', category: '', email: '', phone: '', mobile: '', website: '', notes: '', isActive: true }; error = ''; }
  function startEdit(v: Vendor) { editing = { ...v }; error = ''; }

  async function save() {
    if (!editing?.name?.trim()) { error = tr({ en: 'Name is required.', ar: 'الاسم مطلوب.' }, $locale); return; }
    saving = true; error = '';
    try {
      const body = JSON.stringify(editing);
      if (editing.id) await api(`/vendors/${editing.id}`, { method: 'PUT', body });
      else await api('/vendors', { method: 'POST', body });
      editing = null; await load();
      const all = (await api<{ data: Vendor[] }>('/vendors')).data;
      allCategories = [...new Set(all.map((v) => v.category).filter((c): c is string => !!c))].sort();
    } catch (err) { error = err instanceof ApiError ? err.message : (err as Error).message; }
    finally { saving = false; }
  }

  async function doDelete() {
    if (!confirmDel) return;
    deleting = true;
    try { await api(`/vendors/${confirmDel.id}`, { method: 'DELETE' }); confirmDel = null; await load(); }
    catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); }
    finally { deleting = false; }
  }

  function exportCsv() {
    const head = ['Name', 'Title', 'Category', 'Email', 'Phone', 'Mobile', 'Website', 'Notes'];
    const esc = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const lines = [head.join(','), ...rows.map((v) => [v.name, v.title, v.category, v.email, v.phone, v.mobile, v.website, v.notes].map(esc).join(','))];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'vendors.csv'; a.click(); URL.revokeObjectURL(a.href);
  }

  const AV = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#ef4444'];
  function avatar(name: string) {
    const initials = (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('') || '?';
    let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return { initials, color: AV[h % AV.length] };
  }
  const siteHref = (w: string) => (/^https?:\/\//i.test(w) ? w : `https://${w}`);
</script>

<PageHeader title={tr({ en: 'Vendors', ar: 'الموردون' }, $locale)}>
  {#snippet actions()}
    {#if rows.length}<button class="btn-ghost border border-slate-300 text-sm dark:border-slate-700" onclick={exportCsv}>⬇ {tr({ en: 'Export', ar: 'تصدير' }, $locale)}</button>{/if}
    <button class="btn-primary" onclick={startNew}>{$t('common.new')}</button>
  {/snippet}
</PageHeader>

<PageHint id="vendors" text={{ en: 'Your church address book for suppliers & service providers (electrician, worship gear, caterer, printer…). Filter by category, search any field, and tap a phone/email/website to reach them. Add anyone your team calls regularly.', ar: 'دفتر عناوين كنيستك للموردين ومقدمي الخدمات (كهربائي، معدات العبادة، تموين، طباعة…). صفِّ حسب الفئة، ابحث في أي حقل، واضغط الهاتف/البريد/الموقع للتواصل.' }} />

<div class="mb-4 flex flex-wrap items-center gap-3">
  <input class="input max-w-xs" placeholder={$t('common.search')} bind:value={search} oninput={onSearch} />
  {#if allCategories.length}
    <div class="flex flex-wrap gap-1.5">
      {#each allCategories as c}
        <button class="rounded-full border px-2.5 py-1 text-xs {category === c ? 'border-transparent text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'}" style={category === c ? 'background: var(--brand)' : ''} onclick={() => pickCategory(c)}>{c}</button>
      {/each}
    </div>
  {/if}
</div>

{#if editing}
  <div class="card mb-4 space-y-3 p-5">
    <p class="font-semibold">{editing.id ? tr({ en: 'Edit vendor', ar: 'تعديل مورد' }, $locale) : tr({ en: 'New vendor', ar: 'مورد جديد' }, $locale)}</p>
    {#if error}<p class="text-xs text-rose-600 dark:text-rose-400">{error}</p>{/if}
    <div class="grid gap-3 sm:grid-cols-2">
      <label class="text-sm"><span class="mb-1 block text-slate-500">{tr({ en: 'Name / company', ar: 'الاسم / الشركة' }, $locale)} *</span><input class="input" bind:value={editing.name} /></label>
      <label class="text-sm"><span class="mb-1 block text-slate-500">{tr({ en: 'Title / occupation', ar: 'الوظيفة / المهنة' }, $locale)}</span><input class="input" bind:value={editing.title} /></label>
      <label class="text-sm"><span class="mb-1 block text-slate-500">{tr({ en: 'Category', ar: 'الفئة' }, $locale)}</span><input class="input" list="vendor-cats" bind:value={editing.category} placeholder={tr({ en: 'e.g. Maintenance', ar: 'مثال: صيانة' }, $locale)} /><datalist id="vendor-cats">{#each allCategories as c}<option value={c}></option>{/each}</datalist></label>
      <label class="text-sm"><span class="mb-1 block text-slate-500">{tr({ en: 'Email', ar: 'البريد' }, $locale)}</span><input class="input force-ltr" type="email" bind:value={editing.email} /></label>
      <label class="text-sm"><span class="mb-1 block text-slate-500">{tr({ en: 'Phone', ar: 'الهاتف' }, $locale)}</span><input class="input force-ltr" bind:value={editing.phone} /></label>
      <label class="text-sm"><span class="mb-1 block text-slate-500">{tr({ en: 'Mobile (SMS)', ar: 'الجوال (SMS)' }, $locale)}</span><input class="input force-ltr" bind:value={editing.mobile} /></label>
      <label class="text-sm"><span class="mb-1 block text-slate-500">{tr({ en: 'Website', ar: 'الموقع' }, $locale)}</span><input class="input force-ltr" bind:value={editing.website} /></label>
      <label class="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" bind:checked={editing.isActive} /> {tr({ en: 'Active', ar: 'مُفعّل' }, $locale)}</label>
      <label class="text-sm sm:col-span-2"><span class="mb-1 block text-slate-500">{tr({ en: 'Notes', ar: 'ملاحظات' }, $locale)}</span><textarea class="input" rows="2" bind:value={editing.notes}></textarea></label>
    </div>
    <div class="flex gap-2">
      <button class="btn-primary" onclick={save} disabled={saving}>{saving ? $t('common.loading') : $t('common.save')}</button>
      <button class="btn-ghost" onclick={() => (editing = null)}>{tr({ en: 'Cancel', ar: 'إلغاء' }, $locale)}</button>
    </div>
  </div>
{/if}

{#if loading}
  <p class="text-slate-400">{$t('common.loading')}</p>
{:else if rows.length === 0}
  <div class="card p-10 text-center text-slate-500">{tr({ en: 'No vendors yet — add your first supplier or service provider.', ar: 'لا يوجد موردون بعد — أضِف أول مورد أو مقدّم خدمة.' }, $locale)}</div>
{:else}
  <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
    {#each rows as v (v.id)}
      {@const a = avatar(v.name)}
      <div class="card flex flex-col p-4 {v.isActive === false ? 'opacity-60' : ''}">
        <div class="flex items-start gap-3">
          <span class="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-semibold text-white" style="background:{a.color}">{a.initials}</span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <button class="truncate font-semibold text-primary-700 hover:underline dark:text-primary-300" onclick={() => startEdit(v)}>{v.name}</button>
              {#if v.category}<button class="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300" onclick={() => pickCategory(v.category!)}>{v.category}</button>{/if}
            </div>
            {#if v.title}<p class="truncate text-xs text-slate-500 dark:text-slate-400">{v.title}</p>{/if}
          </div>
        </div>
        {#if v.notes}<p class="mt-2 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{v.notes}</p>{/if}
        <div class="mt-3 flex flex-wrap gap-1.5 force-ltr">
          {#if v.mobile}<a class="rounded-md bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700" href="tel:{v.mobile}">📱 {v.mobile}</a>{/if}
          {#if v.phone}<a class="rounded-md bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700" href="tel:{v.phone}">☎️ {v.phone}</a>{/if}
          {#if v.email}<a class="rounded-md bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700" href="mailto:{v.email}">✉️</a>{/if}
          {#if v.website}<a class="rounded-md bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700" href={siteHref(v.website)} target="_blank" rel="noopener">🌐</a>{/if}
        </div>
        <div class="mt-3 flex items-center justify-end gap-3 border-t border-slate-100 pt-2 text-xs dark:border-slate-800">
          <button class="text-slate-500 hover:underline" onclick={() => startEdit(v)}>{tr({ en: 'Edit', ar: 'تعديل' }, $locale)}</button>
          <button class="text-rose-600 hover:underline dark:text-rose-400" onclick={() => (confirmDel = v)}>{$t('common.delete')}</button>
        </div>
      </div>
    {/each}
  </div>
{/if}

<ConfirmDialog open={confirmDel !== null} danger
  title={tr({ en: 'Delete vendor?', ar: 'حذف المورد؟' }, $locale)}
  message={confirmDel?.name}
  confirmLabel={$t('common.delete')} busy={deleting}
  onconfirm={doDelete} oncancel={() => (confirmDel = null)} />
