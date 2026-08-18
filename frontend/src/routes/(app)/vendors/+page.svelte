<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

  interface Vendor { id: number; name: string; title: string | null; category: string | null; email: string | null; phone: string | null; mobile: string | null; website: string | null; notes: string | null; }

  let rows = $state<Vendor[]>([]);
  let loading = $state(true);
  let search = $state('');
  let timer: ReturnType<typeof setTimeout>;

  // Inline add/edit form
  let editing = $state<Partial<Vendor> | null>(null);
  let saving = $state(false);
  let error = $state('');
  let confirmDel = $state<Vendor | null>(null);
  let deleting = $state(false);

  async function load() {
    loading = true;
    try {
      const q = new URLSearchParams(); if (search.trim()) q.set('search', search.trim());
      rows = (await api<{ data: Vendor[] }>(`/vendors?${q}`)).data;
    } finally { loading = false; }
  }
  function onSearch() { clearTimeout(timer); timer = setTimeout(load, 300); }
  onMount(load);

  function startNew() { editing = { name: '', title: '', category: '', email: '', phone: '', mobile: '', website: '', notes: '' }; error = ''; }
  function startEdit(v: Vendor) { editing = { ...v }; error = ''; }

  async function save() {
    if (!editing?.name?.trim()) { error = tr({ en: 'Name is required.', ar: 'الاسم مطلوب.' }, $locale); return; }
    saving = true; error = '';
    try {
      const body = JSON.stringify(editing);
      if (editing.id) await api(`/vendors/${editing.id}`, { method: 'PUT', body });
      else await api('/vendors', { method: 'POST', body });
      editing = null; await load();
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
</script>

<div class="mb-6 flex items-center justify-between gap-3">
  <h1 class="text-2xl font-semibold">{tr({ en: 'Vendors', ar: 'الموردون' }, $locale)}</h1>
  <button class="btn-primary" onclick={startNew}>{$t('common.new')}</button>
</div>
<p class="mb-4 text-sm text-slate-500 dark:text-slate-400">{tr({ en: 'Suppliers and service providers (electrician, worship gear, caterer…) with their contact details.', ar: 'الموردون ومقدمو الخدمات (كهربائي، معدات العبادة، تموين…) مع بيانات التواصل.' }, $locale)}</p>

<div class="mb-4"><input class="input max-w-xs" placeholder={$t('common.search')} bind:value={search} oninput={onSearch} /></div>

{#if editing}
  <div class="card mb-4 space-y-3 p-5">
    <p class="font-semibold">{editing.id ? tr({ en: 'Edit vendor', ar: 'تعديل مورد' }, $locale) : tr({ en: 'New vendor', ar: 'مورد جديد' }, $locale)}</p>
    {#if error}<p class="text-xs text-rose-600 dark:text-rose-400">{error}</p>{/if}
    <div class="grid gap-3 sm:grid-cols-2">
      <label class="text-sm"><span class="mb-1 block text-slate-500">{tr({ en: 'Name / company', ar: 'الاسم / الشركة' }, $locale)} *</span><input class="input" bind:value={editing.name} /></label>
      <label class="text-sm"><span class="mb-1 block text-slate-500">{tr({ en: 'Title / occupation', ar: 'الوظيفة / المهنة' }, $locale)}</span><input class="input" bind:value={editing.title} /></label>
      <label class="text-sm"><span class="mb-1 block text-slate-500">{tr({ en: 'Category', ar: 'الفئة' }, $locale)}</span><input class="input" bind:value={editing.category} placeholder={tr({ en: 'e.g. Maintenance', ar: 'مثال: صيانة' }, $locale)} /></label>
      <label class="text-sm"><span class="mb-1 block text-slate-500">{tr({ en: 'Email', ar: 'البريد' }, $locale)}</span><input class="input force-ltr" type="email" bind:value={editing.email} /></label>
      <label class="text-sm"><span class="mb-1 block text-slate-500">{tr({ en: 'Phone', ar: 'الهاتف' }, $locale)}</span><input class="input force-ltr" bind:value={editing.phone} /></label>
      <label class="text-sm"><span class="mb-1 block text-slate-500">{tr({ en: 'Mobile (SMS)', ar: 'الجوال (SMS)' }, $locale)}</span><input class="input force-ltr" bind:value={editing.mobile} /></label>
      <label class="text-sm"><span class="mb-1 block text-slate-500">{tr({ en: 'Website', ar: 'الموقع' }, $locale)}</span><input class="input force-ltr" bind:value={editing.website} /></label>
      <label class="text-sm sm:col-span-2"><span class="mb-1 block text-slate-500">{tr({ en: 'Notes', ar: 'ملاحظات' }, $locale)}</span><textarea class="input" rows="2" bind:value={editing.notes}></textarea></label>
    </div>
    <div class="flex gap-2">
      <button class="btn-primary" onclick={save} disabled={saving}>{saving ? $t('common.loading') : $t('common.save')}</button>
      <button class="btn-ghost" onclick={() => (editing = null)}>{tr({ en: 'Cancel', ar: 'إلغاء' }, $locale)}</button>
    </div>
  </div>
{/if}

<div class="card overflow-hidden">
  {#if loading}
    <p class="p-6 text-slate-400">{$t('common.loading')}</p>
  {:else if rows.length === 0}
    <p class="p-8 text-center text-slate-500">{tr({ en: 'No vendors yet.', ar: 'لا يوجد موردون بعد.' }, $locale)}</p>
  {:else}
    <table class="w-full text-sm">
      <thead class="border-b border-slate-200 text-start text-slate-500 dark:border-slate-800">
        <tr>
          <th class="p-3 text-start font-medium">{tr({ en: 'Name', ar: 'الاسم' }, $locale)}</th>
          <th class="p-3 text-start font-medium">{tr({ en: 'Title', ar: 'الوظيفة' }, $locale)}</th>
          <th class="p-3 text-start font-medium">{tr({ en: 'Contact', ar: 'التواصل' }, $locale)}</th>
          <th class="p-3"></th>
        </tr>
      </thead>
      <tbody>
        {#each rows as v}
          <tr class="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
            <td class="p-3">
              <button class="font-medium text-primary-700 hover:underline dark:text-primary-300" onclick={() => startEdit(v)}>{v.name}</button>
              {#if v.category}<span class="ms-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{v.category}</span>{/if}
            </td>
            <td class="p-3 text-slate-600 dark:text-slate-300">{v.title ?? '—'}</td>
            <td class="p-3 force-ltr text-slate-600 dark:text-slate-300">
              {#if v.email}<a class="text-primary-600 hover:underline dark:text-primary-300" href="mailto:{v.email}">{v.email}</a><br />{/if}
              {v.mobile || v.phone || (v.email ? '' : '—')}
            </td>
            <td class="p-3 text-end">
              <button class="text-xs text-rose-600 hover:underline dark:text-rose-400" onclick={() => (confirmDel = v)}>{$t('common.delete')}</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<ConfirmDialog open={confirmDel !== null} danger
  title={tr({ en: 'Delete vendor?', ar: 'حذف المورد؟' }, $locale)}
  message={confirmDel?.name}
  confirmLabel={$t('common.delete')} busy={deleting}
  onconfirm={doDelete} oncancel={() => (confirmDel = null)} />
